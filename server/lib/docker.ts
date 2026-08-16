import Docker from "dockerode";

// Singleton docker instance sharing the same socket configuration
export const docker = new Docker({ 
  socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" 
});

export default docker;
