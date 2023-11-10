#!/bin/bash

STATUS_DONE=$1
STATUS_ERROR=$2

set -o allexport
source ../.env
echo ""
set +o allexport

# echo "D: ----------------------------"
# env | sort
# echo "D: ----------------------------"

CHART_PACKAGE="$TEST_APP_SERVICE_NAME-0.1.0.tgz"
helm package ./deployment/helm --debug --app-version=$IMAGE_TAG
helm upgrade --install \
  --atomic \
  --timeout 60s \
  --namespace $K8S_NAMESPACE \
  --set image.tag=$IMAGE_TAG \
  --set pod.repository=$REGISTRY_URL/$TEST_APP_SERVICE_NAME \
  --set service.port=$TEST_APP_SERVICE_PORT \
  $TEST_APP_SERVICE_NAME ./$CHART_PACKAGE
returnStatus=$(($?+0))
rm $CHART_PACKAGE

echo "returnStatus = ${returnStatus}"
if [ $returnStatus -ne 0 ];
then
  # This will signal to the monitor the stop event
  echo "$STATUS_ERROR"
  exit $returnStatus
fi

result=$(helm --namespace $K8S_NAMESPACE status $TEST_APP_SERVICE_NAME | grep "STATUS")
if [ "${result}" != "STATUS: deployed" ];
then
  echo "result=${result}"
  helm --namespace $K8S_NAMESPACE status $TEST_APP_SERVICE_NAME
  echo "$STATUS_ERROR"
  exit 1
fi

# This will signal to the monitor the stop event
echo "$STATUS_DONE"