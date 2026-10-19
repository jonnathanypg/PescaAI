module.exports = {
  apps: [
    {
      name: 'pescaai-server',
      script: 'dist/server.js',
      cwd: '/root/pescaai',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        DB_TYPE: 'sqlite',
        SQLITE_DB_PATH: './pescaai_data.db',
        DEFAULT_LLM_MODEL: 'gpt-4o-mini',
      },
    },
  ],
};
