#!/bin/bash
# Lets the benchmark user read the session statistics of its sessions (round trips) and the result cache settings.
# gvenzl/oracle-free runs this once, after it creates APP_USER.
sqlplus -s / as sysdba <<SQL
ALTER SESSION SET CONTAINER = FREEPDB1;
GRANT SELECT ON V_\$SESSTAT TO ${APP_USER};
GRANT SELECT ON V_\$STATNAME TO ${APP_USER};
GRANT SELECT ON V_\$PARAMETER TO ${APP_USER};
EXIT
SQL
