ALTER TABLE payables
  ADD COLUMN recurrence               VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN recurrence_day           SMALLINT,
  ADD COLUMN recurrence_end_date      DATE,
  ADD COLUMN recurrence_last_generated DATE,
  ADD COLUMN parent_payable_id        UUID REFERENCES payables(id) ON DELETE SET NULL;

CREATE INDEX idx_payables_recurrence ON payables(tenant_id, recurrence)
  WHERE recurrence != 'none';
