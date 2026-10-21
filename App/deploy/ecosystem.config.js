module.exports = {
  apps: [{
    name: 'coollab',
    script: 'server.js',
    cwd: '/opt/coollab',
    instances: 1,            // SQLite: una sola instancia
    autorestart: true,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production', PORT: 3100 },
  }],
};
