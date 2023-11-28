import * as fs from "fs"

import { LOG_SEPARATOR_LINE, logger } from "./logger.js"
import { DeployedComponent, DeployedTestSuite, GraphDeploymentResult, Namespace, Schema } from "./model.js"
import * as Deployer from "./deployer.js"
import { Config } from "./config.js"
import * as PifFileLoader from "./pitfile/pitfile-loader.js"
import * as K8s from "./k8s.js"
import * as TestRunner from "./test-app-client/test-runner.js"

const deployGraph = async (testSuiteId: string, graph: Schema.Graph, workspace: string, namespace: Namespace, testAppDirForRemoteTestSuite?: string): Promise<GraphDeploymentResult> => {
  const deployments: Array<DeployedComponent> = new Array()
  for (let i = 0; i < graph.components.length; i++) {
    const componentSpec = graph.components[i]
    logger.info("Deploying graph component (%s of %s) \"%s\"...", i + 1, graph.components.length, componentSpec.name)
    logger.info("")
    const commitSha = await Deployer.deployComponent(workspace, componentSpec, namespace)
    deployments.push(new DeployedComponent(commitSha, componentSpec))
  }
  logger.info("")

  logger.info("%s Deploying test app \"%s\" %s", LOG_SEPARATOR_LINE, graph.testApp.name, LOG_SEPARATOR_LINE)
  logger.info("")

  if (testAppDirForRemoteTestSuite) {
    // When suite is remote its pitfile is sitting within test app itself.
    // We just downloaded pitfile from remote location into workspace
    logger.info(
      "Overwriting 'graph.testApp.location.path' to '%s' for testApp: '%s'",
      testAppDirForRemoteTestSuite, graph.testApp.name
    )
    graph.testApp.location.path = testAppDirForRemoteTestSuite
  }
  const params = [ testSuiteId ]
  const testAppCommitSha = await Deployer.deployComponent(workspace, graph.testApp, namespace, params)
  logger.info("")
  return new GraphDeploymentResult(deployments, new DeployedComponent(testAppCommitSha, graph.testApp))
}

const downloadPitFile = async (testSuite: Schema.TestSuite, destination: string): Promise<Schema.PitFile> => {
  await Deployer.cloneFromGit(testSuite.name, testSuite.location, destination)
  logger.info("Loading pitfile from remote test suite '%s'", testSuite.name)
  const pitFileName = testSuite.location.pitFile || PifFileLoader.DEFAULT_PITFILE_NAME
  // TODO how to add test app directory name here??
  const pitfilePath = `${destination}/${pitFileName}`

  const remotePitFile = await PifFileLoader.loadFromFile(pitfilePath)
  //logger.info("\n%s", JSON.stringify(remotePitFile, null, 2))

  return remotePitFile
}

const createWorkspace = async (path: string, suiteName: string) => {
  logger.info("Creating workspace '%s'", path)
  try {
    await fs.promises.access(path, fs.constants.W_OK)
    throw new Error(`Cannot create new workspace '${path}'. Directory or file exists.`)
  } catch (e) {
    // all good, this is expected
  }
  fs.mkdirSync(path)
}

const deployLockManager = async (isEnabled: boolean, namespace: Namespace) => {
  if (isEnabled) {
    logger.info("%s Deploying 'Lock Manager' %s", LOG_SEPARATOR_LINE, LOG_SEPARATOR_LINE)
    logger.info("")
    await Deployer.deployLockManager(namespace)
    logger.info("")
  } else {
    logger.info("%s The 'Lock Manager' will not be deployed %s", LOG_SEPARATOR_LINE, LOG_SEPARATOR_LINE)
    logger.info("")
  }
}

const deployLocal = async (
    config: Config,
    pitfile: Schema.PitFile,
    seqNumber: string,
    testSuite: Schema.TestSuite,
    workspace: string,
    testAppDirForRemoteTestSuite?: string): Promise<DeployedTestSuite> => {
  logger.info("%s Processing test suite '%s' %s", LOG_SEPARATOR_LINE, testSuite.name, LOG_SEPARATOR_LINE)

  const namespace = await K8s.generateNamespaceName(seqNumber)
  await K8s.createNamespace(config.parentNamespace, namespace, config.namespaceTimeoutSeconds, workspace)

  await deployLockManager(pitfile.lockManager.enabled, namespace)

  const deployedGraph = await deployGraph(testSuite.id, testSuite.deployment.graph, workspace, namespace, testAppDirForRemoteTestSuite)

  return new DeployedTestSuite(namespace, testSuite, workspace, deployedGraph)
}

const deployRemote = async (
  config: Config,
  pitfile: Schema.PitFile,
  seqNumber: string,
  testSuite: Schema.TestSuite): Promise<Array<DeployedTestSuite>> => {
  const list = new Array<DeployedTestSuite>()
  // - - - - - - - - - - - - - - - - - - - - -
  // Prepare destination directory name
  const date = new Date()
  const timeToken = date.getMonth() + "" + date.getDay() + "" + date.getHours() + "" + date.getMinutes() + "" + date.getSeconds() + "" + date.getMilliseconds()
  const workspace = `testsuite${timeToken}_${testSuite.id}`
  await createWorkspace(workspace, testSuite.name)
  let destination = workspace
  while (destination.length > 0 && destination.endsWith("/")) {
    destination.substring(0, destination.length - 1)
  }

  const i = destination.lastIndexOf("/")
  if (i !== -1) {
    destination.substring(i + 1)
  }

  destination = `${destination}/${testSuite.id}`
  // - - - - - - - - - - - - - - - - - - - - -

  const remotePitFile = await downloadPitFile(testSuite, destination)

  // Extract test suites from remote file where IDs are matching definition of local ones
  // and deploy them one by one
  for (let subSeqNr = 0; subSeqNr < remotePitFile.testSuites.length; subSeqNr++) {
    const remoteTestSuite = remotePitFile.testSuites[subSeqNr]
    const ids = testSuite.testSuiteIds || []
    const shouldInclude = (ids.length === 0) || (ids.find(id => id === testSuite.id) !== undefined)
    if (!shouldInclude) {
      logger.info("Skipping remote test suite: '%s'", remoteTestSuite.name)
      continue
    }

    const combinedSeqNumber = `${seqNumber}e${(subSeqNr+1)}`
    const testAppDirForRemoteTestSuite = destination
    const summary = await deployLocal(config, pitfile, combinedSeqNumber, remoteTestSuite, workspace, testAppDirForRemoteTestSuite)
    list.push(summary)
  }

  return list
}

const deployAll = async (
  config: Config,
  pitfile: Schema.PitFile,
  seqNumber: string,
  testSuite: Schema.TestSuite): Promise<Array<DeployedTestSuite>> => {

  const deployedSuites = new Array<DeployedTestSuite>()
  if (testSuite.location.type === Schema.LocationType.Local) {
    const workspace = "."
    const summary = await deployLocal(config, pitfile, seqNumber, testSuite, workspace)
    deployedSuites.push(summary)
  } else {
    const list = await deployRemote(config, pitfile, seqNumber, testSuite)
    list.forEach(i => deployedSuites.push(i))
  }

  return deployedSuites
}

export const undeployAll = async (config: Config, suites: Array<DeployedTestSuite>) => {
  for (let item of suites) {
    await Deployer.undeployLockManager(item.namespace)

    await Deployer.undeployComponent(item.namespace, item.workspace, item.graphDeployment.testApp)
    for (let deploymentInfo of item.graphDeployment.components) {
      await Deployer.undeployComponent(item.namespace, item.workspace, deploymentInfo)
    }

    await K8s.deleteNamespace(config.parentNamespace, item.namespace, config.namespaceTimeoutSeconds, item.workspace)
  }
}

export const processTestSuite = async (
  config: Config,
  pitfile: Schema.PitFile,
  seqNumber: string,
  testSuite: Schema.TestSuite): Promise<Array<DeployedTestSuite>> => {
  // By default assume processing strategy to be "deploy all then run tests one by one"
  const list = await deployAll(config, pitfile, seqNumber, testSuite)

  logger.info("")
  logger.info("%s Deployment is done. Running tests. %s", LOG_SEPARATOR_LINE, LOG_SEPARATOR_LINE)
  logger.info("")

  await TestRunner.runAll(config.clusterUrl, list)

  return list
}
