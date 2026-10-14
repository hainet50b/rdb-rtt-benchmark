INSERT INTO w01_item (id, name, payload)
WITH n (i) AS (
  SELECT 1 FROM dual
  UNION ALL
  SELECT i + 1 FROM n WHERE i < 10000
)
SELECT i, 'item-' || i, RPAD('x', 100, 'x') FROM n;
