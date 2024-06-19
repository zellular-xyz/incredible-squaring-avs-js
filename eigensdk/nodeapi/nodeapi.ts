import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {Logger, pino} from 'pino';

// Constants
const BASE_URL = "/eigen";
const SPEC_SEM_VER = "v0.0.1";

// Enums and Models
enum NodeHealth {
    Healthy = 0,
    PartiallyHealthy = 1,
    Unhealthy = 2
}

enum ServiceStatus {
    Up = "Up",
    Down = "Down",
    Initializing = "Initializing"
}

type NodeService = {
    id: string,
    name: string,
    description: string,
    status: ServiceStatus
};

class NodeAPI {
    avsNodeName: string;
    avsNodeSemVer: string;
    health: NodeHealth;
    nodeServices: NodeService[];
    ipPortAddr: string;
    logger: Logger;

    constructor(
        avsNodeName: string,
        avsNodeSemVer: string,
        ipPortAddr: string,
        logger: Logger
    ) {
        this.avsNodeName = avsNodeName;
        this.avsNodeSemVer = avsNodeSemVer;
        this.health = NodeHealth.Healthy;
        this.nodeServices = [];
        this.ipPortAddr = ipPortAddr;
        this.logger = logger;
    }

    updateHealth(health: NodeHealth) {
        this.health = health;
    }

    registerNewService(
        serviceId: string,
        serviceName: string,
        serviceDescription: string,
        serviceStatus: ServiceStatus
    ) {
        const newService: NodeService = {
            id: serviceId,
            name: serviceName,
            description: serviceDescription,
            status: serviceStatus
        };
        this.nodeServices.push(newService);
    }

    updateServiceStatus(serviceId: string, newStatus: ServiceStatus) {
        const service = this.nodeServices.find(s => s.id === serviceId);
        if (service) {
            service.status = newStatus;
        } else {
            throw new Error(`Service with serviceId ${serviceId} not found`);
        }
    }

    deregisterService(serviceId: string) {
        this.nodeServices = this.nodeServices.filter(service => service.id !== serviceId);
    }
}

function nodeHandler(nodeApi: NodeAPI) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
        return {
            node_name: nodeApi.avsNodeName,
            spec_version: SPEC_SEM_VER,
            node_version: nodeApi.avsNodeSemVer
        };
    };
}

function healthHandler(nodeApi: NodeAPI) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
        if (nodeApi.health === NodeHealth.Healthy) {
            return reply.status(200).send();
        } else if (nodeApi.health === NodeHealth.PartiallyHealthy) {
            return reply.status(206).send();
        } else if (nodeApi.health === NodeHealth.Unhealthy) {
            return reply.status(503).send();
        } else {
            nodeApi.logger.error("Unknown health status", { health: nodeApi.health });
            return reply.status(503).send();
        }
    };
}

function servicesHandler(nodeApi: NodeAPI) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
        return { services: nodeApi.nodeServices };
    };
}

function serviceHealthHandler(nodeApi: NodeAPI) {
    return async function (request: FastifyRequest<{ Params: { serviceId: string } }>, reply: FastifyReply) {
        const { serviceId } = request.params;
        const service = nodeApi.nodeServices.find(s => s.id === serviceId);
        if (service) {
            return { service_id: serviceId, status: service.status };
        } else {
            return reply.status(404).send({ detail: "Service not found" });
        }
    };
}

function run(nodeApi: NodeAPI) {
    const app = Fastify({ logger: nodeApi.logger });

    app.get(BASE_URL + '/node', nodeHandler(nodeApi));
    app.get(BASE_URL + '/node/health', healthHandler(nodeApi));
    app.get(BASE_URL + '/node/services', servicesHandler(nodeApi));
    app.get(BASE_URL + '/node/services/:serviceId/health', serviceHealthHandler(nodeApi));

    app.listen({ host: '127.0.0.1', port: 8000 }, (err, address) => {
        if (err) {
            nodeApi.logger.error(err);
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(1);
        }
        nodeApi.logger.info(`Server listening at ${address}`);
    });
}

// Example usage
const logger = pino({ level: 'info' });
const nodeApi = new NodeAPI('AVS Node', '1.0.0', '127.0.0.1:8000', logger);
run(nodeApi);
