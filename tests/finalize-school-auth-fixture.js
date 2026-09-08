'use strict';

globalThis.__BOEKENBAAI_EXCHANGE_GOOGLE_CODE = async (code) => {
  if (code === 'teacher-code') return 'teacher-token';
  if (code === 'student-code') return 'student-token';
  throw new Error('Onverwachte fixture-code');
};

globalThis.__BOEKENBAAI_VERIFY_GOOGLE_ID_TOKEN = async (idToken, options = {}) => {
  if (!options.expectedNonce) throw new Error('OAuth nonce ontbreekt in fixture-verificatie');
  if (idToken === 'teacher-token') {
    return {
      sub: 'google-teacher-sub',
      email: 'gitte.vanbakel@koraaledu.nl',
      name: 'Gitte van Bakel',
      givenName: 'Gitte',
    };
  }
  if (idToken === 'student-token') {
    return {
      sub: 'google-student-sub',
      email: 'sanne@koraaledu.nl',
      name: 'Sanne Google',
      givenName: 'Sanne',
    };
  }
  throw new Error('Onverwacht fixture-token');
};

require('../server.js');
