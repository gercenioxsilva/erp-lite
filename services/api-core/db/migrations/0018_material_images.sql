-- Material product images (1:N — one material can have multiple images)
-- Images are stored as base64 data URIs (same pattern as tenant logo_url).
-- Max 500 KB per image and max 5 images per material are enforced in the API layer.
-- Physical DELETE is used (not soft-delete) because these are binary assets,
-- not auditable business records.

CREATE TABLE material_images (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  material_id UUID        NOT NULL REFERENCES materials(id)  ON DELETE CASCADE,
  image_data  TEXT        NOT NULL,            -- base64 data URI (jpeg/png/webp)
  filename    VARCHAR(255),
  position    SMALLINT    NOT NULL DEFAULT 0,  -- display order (lower = first)
  is_cover    BOOLEAN     NOT NULL DEFAULT false,
  alt         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON material_images(material_id);
CREATE INDEX ON material_images(tenant_id);
