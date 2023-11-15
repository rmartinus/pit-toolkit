#!/bin/bash

# Checks for pods to become available in the namespace

NS=$1

set -o allexport
source .env
if [ "$NS" != "" ];
then
  K8S_NAMESPACE="$NS"
fi
set +o allexport

readyReplicas=$(\
  kubectl -n ${K8S_NAMESPACE} get deployments \
    -l app.kubernetes.io/name=${SERVICE_NAME} \
    -o json | \
    jq '.items[] | .status.readyReplicas')

readyReplicas=$(($readyReplicas+0))

echo "${SERVICE_NAME} has $readyReplicas ready replicas"

if [ $readyReplicas -eq 0 ];
then
  exit 1
fi

exit 0