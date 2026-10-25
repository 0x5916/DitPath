import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  PUBLIC_API_BASE: {
    public: true,
    static: true
  },
  PUBLIC_GOOGLE_CLIENT_ID: {
    public: true,
    static: true,
    schema: (value) => {
      if (!value) return '';
      if (
        value.length > 255 ||
        !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)
      )
        throw new Error('PUBLIC_GOOGLE_CLIENT_ID must be a Google web client ID');
      return value;
    }
  }
});
