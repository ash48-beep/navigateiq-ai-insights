import { Amplify } from 'aws-amplify';

/**
 * Configures Amplify for the ADMIN Cognito User Pool.
 * Called once in AdminAuthGuard before any admin auth checks run.
 */
export function configureAdminAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId:       process.env.REACT_APP_ADMIN_COGNITO_USER_POOL_ID,
        userPoolClientId: process.env.REACT_APP_ADMIN_COGNITO_CLIENT_ID,
        loginWith: { email: true },
      },
    },
  });
}
