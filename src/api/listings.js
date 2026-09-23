const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Enregistre GET /api/listings sur une app Express.
 * @param {import('express').Express} app
 * @param {{ query: Function }} db
 */
export function registerListingsRoute(app, db) {
  app.get("/api/listings", async (req, res) => {
    try {
      const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
      if (!city) {
        return res.status(400).json({ error: "city_required" });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const rawSize = parseInt(String(req.query.pageSize ?? DEFAULT_PAGE_SIZE), 10);
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Number.isFinite(rawSize) ? rawSize : DEFAULT_PAGE_SIZE)
      );
      const offset = (page - 1) * pageSize;

      // Une seule requête : évite le N+1 agencies/photos sous pic de trafic.
      const result = await db.query(
        `SELECT
           l.id,
           l.title,
           l.price,
           l.city,
           l.created_at,
           json_build_object('id', a.id, 'name', a.name) AS agency,
           COALESCE(
             (
               SELECT json_agg(json_build_object('url', p.url) ORDER BY p.id)
               FROM photos p
               WHERE p.listing_id = l.id
             ),
             '[]'::json
           ) AS photos
         FROM listings l
         LEFT JOIN agencies a ON a.id = l.agency_id
         WHERE l.city = $1
         ORDER BY l.created_at DESC
         LIMIT $2 OFFSET $3`,
        [city, pageSize, offset]
      );

      res.json({
        page,
        pageSize,
        items: result.rows,
      });
    } catch (err) {
      console.error("listings.search_failed", { message: err?.message });
      res.status(500).json({ error: "internal_error" });
    }
  });
}
