import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Vérifie la signature HMAC du corps brut (header X-Payment-Signature: sha256=<hex>).
 * Le secret ne doit jamais apparaître dans les logs.
 */
export function verifyPaymentSignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = String(signatureHeader).replace(/^sha256=/, "");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Marque le booking payé de façon idempotente.
 * Retourne true si le statut vient de passer à paid (premier traitement utile).
 */
async function markBookingPaid(db, bookingId, eventId) {
  // event_id unique : ignore les rejeux du prestataire (jusqu'à 5 retries).
  if (eventId) {
    const seen = await db.query(
      `INSERT INTO payment_events (event_id, booking_id, received_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, bookingId]
    );
    if (seen.rowCount === 0) {
      return false;
    }
  }

  const updated = await db.query(
    `UPDATE bookings
     SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
     WHERE id = $1 AND status IS DISTINCT FROM 'paid'
     RETURNING id`,
    [bookingId]
  );
  return updated.rowCount > 0;
}

/**
 * Enregistre POST /webhooks/payment.
 * Ack < 10s obligatoire : le travail lent (email, CRM) part en arrière-plan.
 *
 * @param {import('express').Express} app
 * @param {{ query: Function }} db
 * @param {{
 *   webhookSecret: string,
 *   sendEmail: Function,
 *   notifyCrm: Function,
 *   buildReceipt: Function,
 *   rawBodyParser?: Function
 * }} deps
 */
export function registerPaymentWebhook(app, db, deps) {
  const {
    webhookSecret,
    sendEmail,
    notifyCrm,
    buildReceipt,
  } = deps;

  // express.json({ verify }) doit être branché en amont pour conserver req.rawBody
  app.post("/webhooks/payment", async (req, res) => {
    const signature = req.get("X-Payment-Signature");
    const rawBody = req.rawBody ?? JSON.stringify(req.body);

    if (!verifyPaymentSignature(rawBody, signature, webhookSecret)) {
      return res.status(401).send("invalid_signature");
    }

    const event = req.body;
    if (!event || typeof event !== "object") {
      return res.status(400).send("invalid_payload");
    }

    // Ack immédiat : le prestataire timeout à 10s et réessaie sinon.
    res.status(200).send("ok");

    if (event.type !== "payment.succeeded") {
      return;
    }

    const bookingId = event.booking_id;
    if (!bookingId) {
      console.error("payment.webhook_missing_booking_id", {
        eventId: event.id ?? null,
      });
      return;
    }

    try {
      const firstTime = await markBookingPaid(db, bookingId, event.id);
      if (!firstTime) {
        return;
      }

      // Hors chemin critique HTTP — échec email/CRM ne doit pas provoquer de retry webhook.
      Promise.resolve()
        .then(async () => {
          if (event.customer_email) {
            await sendEmail(
              event.customer_email,
              "Paiement confirmé",
              buildReceipt(event)
            );
          }
          await notifyCrm(event);
        })
        .catch((err) => {
          console.error("payment.post_process_failed", {
            bookingId,
            eventId: event.id ?? null,
            message: err?.message,
          });
        });
    } catch (err) {
      console.error("payment.mark_paid_failed", {
        bookingId,
        eventId: event.id ?? null,
        message: err?.message,
      });
    }
  });
}
