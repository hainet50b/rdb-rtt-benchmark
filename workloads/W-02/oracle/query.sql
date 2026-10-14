SELECT seq, name, payload
  FROM w02_line
 WHERE seq <= :rows
 ORDER BY seq
