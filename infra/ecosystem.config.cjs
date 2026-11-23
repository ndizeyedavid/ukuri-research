module.exports = {
  apps: [
    {
      name: 'ukuri',
      script: 'server/index.js',
      cwd: '/var/www/ukuri-research-auditor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
      },
      out_file: '/var/log/ukuri/out.log',
      error_file: '/var/log/ukuri/error.log',
      time: true,
    },
  ],
};
