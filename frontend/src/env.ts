import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  PUBLIC_API_BASE: {
    public: true,
    static: true
  }
});
