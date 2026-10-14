#!/bin/sh
# Usage: delay MILLISECONDS
#
# Delays every packet that leaves this network namespace.
# Only the measurement application joins this namespace, and it talks only to the database,
# so each round trip passes this network interface once and is delayed by MILLISECONDS.
set -eu
tc qdisc replace dev eth0 root netem delay "${1}ms"
