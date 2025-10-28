import {
  AgentlangAuth,
  InviteUserCallback,
  InvitationInfo,
  LoginCallback,
  LogoutCallback,
  SessionInfo,
  SignUpCallback,
  UserInfo,
} from './interface.js';
import {
  ensureUser,
  ensureUserRoles,
  ensureUserSession,
  findUser,
  findUserByEmail,
} from '../modules/auth.js';
import { logger } from '../logger.js';
import { sleepMilliseconds } from '../util.js';
import { Instance } from '../module.js';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Environment } from '../interpreter.js';
import { isNodeEnv } from '../../utils/runtime.js';
import {
  UnauthorisedError,
  UserNotFoundError,
  UserNotConfirmedError,
  PasswordResetRequiredError,
  TooManyRequestsError,
  InvalidParameterError,
  ExpiredCodeError,
  CodeMismatchError,
  BadRequestError,
} from '../defs.js';

let fromEnv: any = undefined;
let CognitoIdentityProviderClient: any = undefined;
let SignUpCommand: any = undefined;
let ConfirmSignUp: any = undefined;
let ResendConfirmationCodeCommand: any = undefined;
let ForgotPasswordCommand: any = undefined;
let ConfirmForgotPasswordCommand: any = undefined;
let AdminGetUserCommand: any = undefined;
let InitiateAuthCommand: any = undefined;
let AdminCreateUserCommand: any = undefined;
let RespondToAuthChallengeCommand: any = undefined;
let AuthenticationDetails: any = undefined;
let CognitoUser: any = undefined;
let CognitoUserPool: any = undefined;
let CognitoUserSession: any = undefined;
let CognitoIdToken: any = undefined;
let CognitoAccessToken: any = undefined;
let CognitoRefreshToken: any = undefined;

if (isNodeEnv) {
  const cp = await import('@aws-sdk/credential-providers');
  fromEnv = cp.fromEnv;

  const cip = await import('@aws-sdk/client-cognito-identity-provider');
  CognitoIdentityProviderClient = cip.CognitoIdentityProviderClient;
  SignUpCommand = cip.SignUpCommand;
  ConfirmSignUp = cip.ConfirmSignUpCommand;
  ResendConfirmationCodeCommand = cip.ResendConfirmationCodeCommand;
  ForgotPasswordCommand = cip.ForgotPasswordCommand;
  ConfirmForgotPasswordCommand = cip.ConfirmForgotPasswordCommand;
  AdminGetUserCommand = cip.AdminGetUserCommand;
  InitiateAuthCommand = cip.InitiateAuthCommand;
  AdminCreateUserCommand = cip.AdminCreateUserCommand;
  RespondToAuthChallengeCommand = cip.RespondToAuthChallengeCommand;

  const ci = await import('amazon-cognito-identity-js');
  AuthenticationDetails = ci.AuthenticationDetails;
  CognitoUser = ci.CognitoUser;
  CognitoUserPool = ci.CognitoUserPool;
  CognitoUserSession = ci.CognitoUserSession;
  CognitoIdToken = ci.CognitoIdToken;
  CognitoAccessToken = ci.CognitoAccessToken;
  CognitoRefreshToken = ci.CognitoRefreshToken;
}

const defaultConfig = isNodeEnv
  ? new Map<string, string | undefined>()
      .set('UserPoolId', process.env.COGNITO_USER_POOL_ID)
      .set('ClientId', process.env.COGNITO_CLIENT_ID)
  : new Map();

// Helper function to parse Cognito error and throw appropriate custom error
function handleCognitoError(err: any, context: string): never {
  // Log error details for debugging (sanitize sensitive information)
  const sanitizedMessage = sanitizeErrorMessage(err.message || '');
  logger.error(`Cognito error in ${context}: ${err.name} - ${sanitizedMessage}`, {
    errorName: err.name,
    errorCode: err.code,
    context: context,
    statusCode: err.$metadata?.httpStatusCode,
  });

  // Handle specific Cognito errors with user-friendly messages
  switch (err.name) {
    case 'UserNotFoundException':
      logger.debug(`User not found in context: ${context}`);
      throw new UserNotFoundError('User account not found. Please check your email or sign up.');

    case 'NotAuthorizedException':
      // Check if this is a password-related error vs other auth issues
      if (err.message && err.message.includes('password')) {
        logger.debug(`Invalid password attempt in context: ${context}`);
        throw new UnauthorisedError('Invalid password. Please try again.');
      } else if (err.message && err.message.includes('not confirmed')) {
        logger.debug(`User not confirmed in context: ${context}`);
        throw new UserNotConfirmedError();
      } else {
        logger.debug(`Authentication failed in context: ${context}`);
        throw new UnauthorisedError('Authentication failed. Please check your credentials.');
      }

    case 'UserNotConfirmedException':
      logger.debug(`User not confirmed in context: ${context}`);
      throw new UserNotConfirmedError();

    case 'PasswordResetRequiredException':
      logger.debug(`Password reset required in context: ${context}`);
      throw new PasswordResetRequiredError();

    case 'TooManyRequestsException':
      logger.warn(`Rate limit exceeded in context: ${context}`);
      throw new TooManyRequestsError();

    case 'TooManyFailedAttemptsException':
      logger.warn(`Too many failed attempts in context: ${context}`);
      throw new TooManyRequestsError('Too many failed login attempts. Please try again later.');

    case 'InvalidParameterException':
      logger.debug(`Invalid parameters in context: ${context}`);
      throw new InvalidParameterError(
        sanitizeErrorMessage(err.message) || 'Invalid parameters provided'
      );

    case 'ExpiredCodeException':
      logger.debug(`Expired code in context: ${context}`);
      throw new ExpiredCodeError();

    case 'CodeMismatchException':
      logger.debug(`Code mismatch in context: ${context}`);
      throw new CodeMismatchError();

    case 'UsernameExistsException':
      logger.debug(`Username exists in context: ${context}`);
      throw new BadRequestError('An account with this email already exists.');

    case 'InvalidPasswordException':
      logger.debug(`Invalid password format in context: ${context}`);
      throw new BadRequestError(
        'Password does not meet requirements. It must be at least 8 characters long and contain uppercase, lowercase, numbers, and special characters.'
      );

    case 'LimitExceededException':
      logger.warn(`Service limit exceeded in context: ${context}`);
      throw new TooManyRequestsError('Service limit exceeded. Please try again later.');

    case 'InternalErrorException':
      logger.error(`Internal Cognito error in context: ${context}`);
      throw new Error('Authentication service is temporarily unavailable. Please try again later.');

    case 'ResourceNotFoundException':
      logger.error(`Resource not found in context: ${context}`);
      throw new Error('Authentication service configuration error. Please contact support.');

    case 'AliasExistsException':
      logger.debug(`Alias exists in context: ${context}`);
      throw new BadRequestError('An account with this email already exists.');

    case 'InvalidEmailRoleAccessPolicyException':
      logger.error(`Invalid email role access policy in context: ${context}`);
      throw new Error('Email service configuration error. Please contact support.');

    case 'UserLambdaValidationException':
      logger.error(`User lambda validation error in context: ${context}`);
      throw new BadRequestError('User validation failed. Please check your input and try again.');

    case 'UnsupportedUserStateException':
      logger.debug(`Unsupported user state in context: ${context}`);
      throw new UserNotConfirmedError(
        'User account is in an unsupported state. Please contact support.'
      );

    case 'MFAMethodNotFoundException':
      logger.debug(`MFA method not found in context: ${context}`);
      throw new BadRequestError('MFA method not found. Please set up MFA and try again.');

    case 'CodeDeliveryFailureException':
      logger.error(`Code delivery failure in context: ${context}`);
      throw new Error('Unable to deliver verification code. Please try again later.');

    case 'DuplicateProviderException':
      logger.error(`Duplicate provider in context: ${context}`);
      throw new BadRequestError('Authentication provider already exists.');

    case 'EnableSoftwareTokenMFAException':
      logger.debug(`Software token MFA required in context: ${context}`);
      throw new BadRequestError('Software token MFA setup required.');

    case 'ForbiddenException':
      logger.warn(`Forbidden access in context: ${context}`);
      throw new UnauthorisedError('Access forbidden. Please check your permissions.');

    case 'GroupExistsException':
      logger.debug(`Group exists in context: ${context}`);
      throw new BadRequestError('Group already exists.');

    case 'InvalidLambdaResponseException':
      logger.error(`Invalid lambda response in context: ${context}`);
      throw new Error('Authentication service error. Please try again later.');

    case 'InvalidOAuthFlowException':
      logger.error(`Invalid OAuth flow in context: ${context}`);
      throw new BadRequestError('Invalid OAuth flow. Please try again.');

    case 'InvalidSmsRoleAccessPolicyException':
      logger.error(`Invalid SMS role access policy in context: ${context}`);
      throw new Error('SMS service configuration error. Please contact support.');

    case 'InvalidSmsRoleTrustRelationshipException':
      logger.error(`Invalid SMS role trust relationship in context: ${context}`);
      throw new Error('SMS service configuration error. Please contact support.');

    case 'InvalidUserPoolConfigurationException':
      logger.error(`Invalid user pool configuration in context: ${context}`);
      throw new Error('Authentication service configuration error. Please contact support.');

    case 'PreconditionNotMetException':
      logger.debug(`Precondition not met in context: ${context}`);
      throw new BadRequestError('Precondition not met. Please check your request and try again.');

    case 'ScopeDoesNotExistException':
      logger.error(`Scope does not exist in context: ${context}`);
      throw new BadRequestError('Invalid scope. Please check your request.');

    case 'UnexpectedLambdaException':
      logger.error(`Unexpected lambda exception in context: ${context}`);
      throw new Error('Authentication service error. Please try again later.');

    case 'UserImportInProgressException':
      logger.warn(`User import in progress in context: ${context}`);
      throw new TooManyRequestsError('User import in progress. Please try again later.');

    case 'UserPoolTaggingException':
      logger.error(`User pool tagging exception in context: ${context}`);
      throw new Error('Authentication service configuration error. Please contact support.');

    default:
      // For any other errors, throw a generic error with sanitized message
      logger.error(`Unhandled Cognito error: ${err.name}`, {
        errorName: err.name,
        errorCode: err.code,
        context: context,
      });
      throw new Error(
        `Authentication error: ${sanitizeErrorMessage(err.message) || 'An unexpected error occurred'}`
      );
  }
}

// Helper function to sanitize error messages to prevent sensitive information exposure
function sanitizeErrorMessage(message: string): string {
  if (!message) return '';

  // Remove any potential sensitive information patterns
  return message
    .replace(/password/gi, '[REDACTED]')
    .replace(/token/gi, '[REDACTED]')
    .replace(/secret/gi, '[REDACTED]')
    .replace(/key/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[TOKEN_REDACTED]')
    .replace(/\b\d{4,}\b/g, '[NUMBER_REDACTED]');
}

// Helper function to get HTTP status code for error type
export function getHttpStatusForError(error: Error): number {
  if (error instanceof UnauthorisedError) return 401;
  if (error instanceof UserNotFoundError) return 404;
  if (error instanceof TooManyRequestsError) return 429;
  if (error instanceof BadRequestError) return 400;
  if (error instanceof InvalidParameterError) return 400;
  if (error instanceof UserNotConfirmedError) return 403;
  if (error instanceof PasswordResetRequiredError) return 403;
  if (error instanceof ExpiredCodeError) return 400;
  if (error instanceof CodeMismatchError) return 400;

  // Check error message for additional context
  if (error.message) {
    if (
      error.message.includes('temporarily unavailable') ||
      error.message.includes('service error') ||
      error.message.includes('configuration error')
    ) {
      return 503; // Service Unavailable
    }
    if (error.message.includes('contact support')) {
      return 500; // Internal Server Error
    }
  }

  return 500; // Internal server error for unknown errors
}

export class CognitoAuth implements AgentlangAuth {
  config: Map<string, string | undefined>;
  userPool: any;
  constructor(config?: Map<string, string>) {
    this.config = config ? config : defaultConfig;
    const upid = this.config.get('UserPoolId');
    if (upid)
      this.userPool = new CognitoUserPool({
        UserPoolId: upid,
        ClientId: this.fetchClientId(),
      });
  }

  fetchUserPoolId(): string {
    return this.fetchConfig('UserPoolId');
  }

  fetchClientId(): string {
    return this.fetchConfig('ClientId');
  }

  private fetchConfig(k: string): string {
    const id = this.config.get(k);
    if (id) {
      return id;
    }
    throw new Error(`${k} is not set`);
  }

  async signUp(
    firstName: string,
    lastName: string,
    username: string,
    password: string,
    userData: Map<string, string> | undefined,
    env: Environment,
    cb: SignUpCallback
  ): Promise<void> {
    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: fromEnv(),
    });
    const userAttrs = [
      {
        Name: 'email',
        Value: username,
      },
      {
        Name: 'name',
        Value: username,
      },
      {
        Name: 'given_name',
        Value: firstName,
      },
      {
        Name: 'family_name',
        Value: lastName,
      },
    ];
    if (userData) {
      userData.forEach((v: string, k: string) => {
        userAttrs.push({ Name: k, Value: v });
      });
    }
    const input = {
      ClientId: this.config.get('ClientId'),
      Username: username,
      Password: password,
      UserAttributes: userAttrs,
      ValidationData: userAttrs,
    };
    const command = new SignUpCommand(input);
    try {
      logger.debug(`Attempting signup for user: ${username}`);
      const response = await client.send(command);

      if (response.$metadata.httpStatusCode == 200) {
        logger.info(`Signup successful for user: ${username}`);
        const user = await ensureUser(username, firstName, lastName, env);
        const userInfo: UserInfo = {
          username: username,
          firstName: firstName,
          lastName: lastName,
          id: user.id,
          systemUserInfo: response.UserSub,
        };
        cb(userInfo);
      } else {
        logger.error(`Signup failed with HTTP status ${response.$metadata.httpStatusCode}`, {
          username: username,
          statusCode: response.$metadata.httpStatusCode,
        });
        throw new BadRequestError(`Signup failed with status ${response.$metadata.httpStatusCode}`);
      }
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      logger.error(`Signup error for user ${username}:`, {
        errorName: err.name,
        errorMessage: sanitizeErrorMessage(err.message),
      });
      handleCognitoError(err, 'signUp');
    }
  }

  async confirmSignup(username: string, confirmationCode: string, _: Environment): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });
      const command = new ConfirmSignUp({
        ClientId: this.config.get('ClientId'),
        Username: username,
        ConfirmationCode: confirmationCode,
      });
      await client.send(command);
    } catch (error: any) {
      logger.error(`Failed to confirm signup: ${error.message}`);
      handleCognitoError(error, 'confirmSignup');
    }
  }

  async resendConfirmationCode(username: string, _: Environment): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });
      const command = new ResendConfirmationCodeCommand({
        ClientId: this.config.get('ClientId'),
        Username: username,
      });
      await client.send(command);
    } catch (error: any) {
      logger.error(`Failed to resend confirmation code: ${error.message}`);
      handleCognitoError(error, 'resendConfirmationCode');
    }
  }

  async forgotPassword(username: string, _env: Environment): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });
      const command = new ForgotPasswordCommand({
        ClientId: this.fetchClientId(),
        Username: username,
      });
      await client.send(command);
    } catch (err: any) {
      logger.error(`Forgot password failed for ${username}: ${sanitizeErrorMessage(err.message)}`);
      handleCognitoError(err, 'forgotPassword');
    }
  }

  async confirmForgotPassword(
    username: string,
    confirmationCode: string,
    newPassword: string,
    _env: Environment
  ): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });
      const command = new ConfirmForgotPasswordCommand({
        ClientId: this.fetchClientId(),
        Username: username,
        ConfirmationCode: confirmationCode,
        Password: newPassword,
      });
      await client.send(command);
    } catch (err: any) {
      logger.error(
        `Confirm forgot password failed for ${username}: ${sanitizeErrorMessage(err.message)}`
      );
      handleCognitoError(err, 'confirmForgotPassword');
    }
  }

  async login(
    username: string,
    password: string,
    env: Environment,
    cb: LoginCallback
  ): Promise<void> {
    // Check if Cognito is configured
    const cognitoConfigured = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID;

    if (cognitoConfigured) {
      // Cognito-first: authenticate directly with Cognito without local store dependency
      const user = new CognitoUser({
        Username: username,
        Pool: this.fetchUserPool(),
      });
      const authDetails = new AuthenticationDetails({
        Username: username,
        Password: password,
      });
      let result: any;
      let authError: any;
      user.authenticateUser(authDetails, {
        onSuccess: (session: any) => {
          result = session;
        },
        onFailure: (err: any) => {
          logger.debug(`Cognito authentication failed for user ${username}:`, {
            errorName: err.name,
            errorMessage: sanitizeErrorMessage(err.message),
          });
          authError = err;
        },
        mfaRequired: (challengeName: any, _challengeParameters: any) => {
          logger.info(`MFA required for user ${username}: ${challengeName}`);
          authError = new Error('MFA authentication required');
        },
        newPasswordRequired: (_userAttributes: any, _requiredAttributes: any) => {
          logger.info(`New password required for user ${username}`);
          authError = new PasswordResetRequiredError(
            'New password required. Please reset your password.'
          );
        },
      });
      while (result === undefined && authError === undefined) {
        await sleepMilliseconds(100);
      }
      if (authError) {
        if (authError instanceof PasswordResetRequiredError) {
          throw authError;
        }
        logger.error(`Login failed for user ${username}:`, {
          errorName: authError.name,
          errorMessage: sanitizeErrorMessage(authError.message),
        });
        handleCognitoError(authError, 'login');
      }
      if (result) {
        // After successful Cognito authentication, create/update local records
        const localUser = await ensureUser(username, '', '', env);
        const userid = localUser.lookup('id');

        const idtok = result.getIdToken();
        const idToken = idtok.getJwtToken();
        const idTokenPayload = idtok.decodePayload();

        const firstName = idTokenPayload['given_name'] || idTokenPayload['name'] || '';
        const lastName = idTokenPayload['family_name'] || '';
        const userGroups = idTokenPayload['cognito:groups'];

        let localUser = await findUserByEmail(username, env);
        if (!localUser) {
          localUser = await ensureUser(username, firstName, lastName, env);
        }
        const userid = localUser.lookup('id');
        if (userGroups) {
          await ensureUserRoles(userid, userGroups, env);
        }
        const accessToken = result.getAccessToken().getJwtToken();
        const refreshToken = result.getRefreshToken().getToken();
        const localSess: Instance = await ensureUserSession(
          userid,
          idToken,
          accessToken,
          refreshToken,
          env
        );
        const sessInfo: SessionInfo = {
          sessionId: localSess.lookup('id'),
          userId: userid,
          authToken: idToken,
          idToken: idToken,
          accessToken: accessToken,
          refreshToken: refreshToken,
          systemSesionInfo: result,
        };
        cb(sessInfo);
      } else {
        logger.error(`Login failed for ${username} - no result received`);
        throw new UnauthorisedError('Login failed. Please try again.');
      }
    } else {
      // Cognito not configured, fall back to local authentication
      const localUser = await ensureUser(username, '', '', env);
      const user = new CognitoUser({
        Username: username,
        Pool: this.fetchUserPool(),
      });
      const authDetails = new AuthenticationDetails({
        Username: username,
        Password: password,
      });
      let result: any;
      let authError: any;
      user.authenticateUser(authDetails, {
        onSuccess: (session: any) => {
          result = session;
        },
        onFailure: (err: any) => {
          logger.debug(`Cognito authentication failed for user ${username}:`, {
            errorName: err.name,
            errorMessage: sanitizeErrorMessage(err.message),
          });
          authError = err;
        },
        mfaRequired: (challengeName: any, _challengeParameters: any) => {
          logger.info(`MFA required for user ${username}: ${challengeName}`);
          authError = new Error('MFA authentication required');
        },
        newPasswordRequired: (_userAttributes: any, _requiredAttributes: any) => {
          logger.info(`New password required for user ${username}`);
          authError = new PasswordResetRequiredError(
            'New password required. Please reset your password.'
          );
        },
      });
      while (result === undefined && authError === undefined) {
        await sleepMilliseconds(100);
      }
      if (authError) {
        if (authError instanceof PasswordResetRequiredError) {
          throw authError;
        }
        logger.error(`Login failed for user ${username}:`, {
          errorName: authError.name,
          errorMessage: sanitizeErrorMessage(authError.message),
        });
        handleCognitoError(authError, 'login');
      }
      if (result) {
        const userid = localUser.lookup('id');
        const idToken = result.getIdToken().getJwtToken();
        const accessToken = result.getAccessToken().getJwtToken();
        const refreshToken = result.getRefreshToken().getToken();
        const localSess: Instance = await ensureUserSession(
          userid,
          idToken,
          accessToken,
          refreshToken,
          env
        );
        const sessInfo: SessionInfo = {
          sessionId: localSess.lookup('id'),
          userId: userid,
          authToken: idToken,
          idToken: idToken,
          accessToken: accessToken,
          refreshToken: refreshToken,
          systemSesionInfo: result,
        };
        cb(sessInfo);
      } else {
        logger.error(`Login failed for ${username} - no result received`);
        throw new UnauthorisedError('Login failed. Please try again.');
      }
    }
  }

  async logout(sessionInfo: SessionInfo, env: Environment, cb?: LogoutCallback): Promise<void> {
    try {
      const localUser = await findUser(sessionInfo.userId, env);
      if (!localUser) {
        logger.warn(`User ${sessionInfo.userId} not found during logout`);
        if (cb) cb(true);
        return;
      }
      const user = new CognitoUser({
        Username: localUser.lookup('email'),
        Pool: this.fetchUserPool(),
      });

      let done = false;
      let logoutError: any;

      const session = new CognitoUserSession({
        IdToken: new CognitoIdToken({ IdToken: sessionInfo.idToken }),
        AccessToken: new CognitoAccessToken({ AccessToken: sessionInfo.accessToken }),
        RefreshToken: new CognitoRefreshToken({ RefreshToken: sessionInfo.refreshToken }),
      });
      user.setSignInUserSession(session);
      user.globalSignOut({
        onSuccess: function () {
          done = true;
        },
        onFailure: function (err: any) {
          done = true;
          logger.error(`Cognito signOut error for user ${sessionInfo.userId}:`, {
            errorName: err.name,
            errorMessage: sanitizeErrorMessage(err.message),
          });
          logoutError = err;
        },
      });

      while (!done) {
        await sleepMilliseconds(100);
      }
      if (logoutError) {
        logger.error(
          `Error during Cognito logout for user ${sessionInfo.userId}: ${logoutError.message}`
        );
        // Continue with local session cleanup even if Cognito logout fails
      }
      logger.debug(`Successfully logged out user ${sessionInfo.userId}`);
      if (cb) cb(true);
    } catch (err: any) {
      logger.error(`Logout failed for user ${sessionInfo.userId}: ${err.message}`);
      if (cb) cb(false);
      throw err;
    }
  }

  async changePassword(
    sessionInfo: SessionInfo,
    newPassword: string,
    oldPassword: string,
    env: Environment
  ): Promise<boolean> {
    const localUser = await findUser(sessionInfo.userId, env);
    if (!localUser) {
      logger.warn(`User ${sessionInfo.userId} not found for password-change`);
      return false;
    }
    const email = localUser.lookup('email');
    const user = new CognitoUser({
      Username: email,
      Pool: this.fetchUserPool(),
    });
    const session = new CognitoUserSession({
      IdToken: new CognitoIdToken({ IdToken: sessionInfo.idToken }),
      AccessToken: new CognitoAccessToken({ AccessToken: sessionInfo.accessToken }),
      RefreshToken: new CognitoRefreshToken({ RefreshToken: sessionInfo.refreshToken }),
    });
    user.setSignInUserSession(session);
    let done = false;
    let cpErr: any = undefined;
    user.changePassword(oldPassword, newPassword, (err: any, _: any) => {
      if (err) {
        done = true;
        cpErr = err;
      } else {
        done = true;
      }
    });

    while (!done) {
      await sleepMilliseconds(100);
    }

    if (cpErr) {
      logger.warn(`Failed to change the password for ${email} - ${cpErr.message}`);
      return false;
    }
    return true;
  }

  private fetchUserPool() {
    if (this.userPool) {
      return this.userPool;
    }
    throw new Error('UserPool not initialized');
  }

  async verifyToken(token: string): Promise<void> {
    try {
      const verifier = CognitoJwtVerifier.create({
        userPoolId: this.fetchUserPoolId(),
        tokenUse: 'id',
        clientId: this.fetchClientId(),
      });

      const payload = await verifier.verify(token);
      logger.debug(`Decoded JWT for ${payload.email}`);
    } catch (err: any) {
      logger.error(`Token verification failed:`, {
        errorName: err.name,
        errorMessage: sanitizeErrorMessage(err.message),
      });

      // Handle specific token verification errors
      if (err.message && err.message.includes('expired')) {
        throw new UnauthorisedError('Token has expired. Please login again.');
      }
      if (err.message && err.message.includes('invalid')) {
        throw new UnauthorisedError('Invalid token format.');
      }
      if (err.message && err.message.includes('not before')) {
        throw new UnauthorisedError('Token is not yet valid.');
      }
      if (err.message && err.message.includes('audience')) {
        throw new UnauthorisedError('Token audience mismatch.');
      }

      throw new UnauthorisedError(
        `Token verification failed: ${sanitizeErrorMessage(err.message) || 'Invalid token'}`
      );
    }
  }

  async getUser(userId: string, env: Environment): Promise<UserInfo> {
    const localUser = await findUser(userId, env);
    if (!localUser) {
      throw new UserNotFoundError(`User ${userId} not found in local database`);
    }

    const userEmail = localUser.lookup('email');
    const firstName = localUser.lookup('firstName');
    const lastName = localUser.lookup('lastName');

    // Check if Cognito is configured
    const cognitoConfigured = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID;

    if (cognitoConfigured && userEmail) {
      try {
        // Get additional user details from Cognito
        const client = new CognitoIdentityProviderClient({
          region: process.env.AWS_REGION || 'us-west-2',
          credentials: fromEnv(),
        });

        const command = new AdminGetUserCommand({
          UserPoolId: this.fetchUserPoolId(),
          Username: userEmail,
        });

        const response = await client.send(command);

        // Return user info with both local and Cognito data
        return {
          id: userId,
          username: userEmail,
          firstName: firstName,
          lastName: lastName,
          systemUserInfo: {
            localUser: localUser,
            cognitoData: {
              userAttributes: response.UserAttributes,
              userCreateDate: response.UserCreateDate,
              userLastModifiedDate: response.UserLastModifiedDate,
              userStatus: response.UserStatus,
              enabled: response.Enabled,
              preferredMfaSetting: response.PreferredMfaSetting,
              userMFASettingList: response.UserMFASettingList,
            },
          },
        };
      } catch (err: any) {
        logger.warn(`Failed to get Cognito user info for ${userEmail}, using local data only:`, {
          errorName: err.name,
          errorMessage: sanitizeErrorMessage(err.message),
        });
        // Fall back to local data only
        return {
          id: userId,
          username: userEmail,
          firstName: firstName,
          lastName: lastName,
          systemUserInfo: localUser,
        };
      }
    } else {
      // Cognito not configured or no email, use local data only
      return {
        id: userId,
        username: userEmail || userId,
        firstName: firstName,
        lastName: lastName,
        systemUserInfo: localUser,
      };
    }
  }

  async getUserByEmail(email: string, env: Environment): Promise<UserInfo> {
    const localUser = await findUserByEmail(email, env);
    if (!localUser) {
      throw new UserNotFoundError(`User with email ${email} not found in local database`);
    }

    const userId = localUser.lookup('id');
    const firstName = localUser.lookup('firstName');
    const lastName = localUser.lookup('lastName');

    // Check if Cognito is configured
    const cognitoConfigured = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID;

    if (cognitoConfigured) {
      try {
        // Get additional user details from Cognito
        const client = new CognitoIdentityProviderClient({
          region: process.env.AWS_REGION || 'us-west-2',
        });

        const command = new AdminGetUserCommand({
          UserPoolId: this.fetchUserPoolId(),
          ClientId: this.fetchClientId(),
          Username: email,
        });

        const response = await client.send(command);

        // Return user info with both local and Cognito data
        return {
          id: userId,
          username: email,
          firstName: firstName,
          lastName: lastName,
          systemUserInfo: {
            localUser: localUser,
            cognitoData: {
              userAttributes: response.UserAttributes,
              userCreateDate: response.UserCreateDate,
              userLastModifiedDate: response.UserLastModifiedDate,
              userStatus: response.UserStatus,
              enabled: response.Enabled,
              preferredMfaSetting: response.PreferredMfaSetting,
              userMFASettingList: response.UserMFASettingList,
            },
          },
        };
      } catch (err: any) {
        console.log(`Failed to get Cognito user info for email ${email}, using local data only:`, {
          errorName: err.name,
          errorMessage: sanitizeErrorMessage(err.message),
        });
        // Fall back to local data only
        return {
          id: userId,
          username: email,
          firstName: firstName,
          lastName: lastName,
          systemUserInfo: localUser,
        };
      }
    } else {
      // Cognito not configured, use local data only
      return {
        id: userId,
        username: email,
        firstName: firstName,
        lastName: lastName,
        systemUserInfo: localUser,
      };
    }
  }

  async refreshToken(refreshTokenString: string, env: Environment): Promise<SessionInfo> {
    try {
      // Use InitiateAuth with REFRESH_TOKEN_AUTH flow
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });

      const command = new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: this.fetchClientId(),
        AuthParameters: {
          REFRESH_TOKEN: refreshTokenString,
        },
      });

      const response = await client.send(command);

      if (!response.AuthenticationResult) {
        throw new UnauthorisedError('Token refresh failed');
      }

      const newIdToken = response.AuthenticationResult.IdToken!;
      const newAccessToken = response.AuthenticationResult.AccessToken!;
      const newRefreshToken = response.AuthenticationResult.RefreshToken || refreshTokenString;

      // Extract user info from the new ID token
      const idTokenPayload = JSON.parse(atob(newIdToken.split('.')[1]));
      const userEmail = idTokenPayload.email;

      // Find or create local user
      const localUser = await ensureUser(userEmail, '', '', env);

      const userId = localUser.lookup('id');

      // Update local session
      const updatedSession = await ensureUserSession(
        userId,
        newIdToken,
        newAccessToken,
        newRefreshToken,
        env
      );

      const sessInfo: SessionInfo = {
        sessionId: updatedSession.lookup('id'),
        userId: userId,
        authToken: newIdToken,
        idToken: newIdToken,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        systemSesionInfo: response.AuthenticationResult,
      };

      return sessInfo;
    } catch (err: any) {
      logger.error(`Refresh token operation failed: ${err.message}`);
      if (err.name === 'NotAuthorizedException') {
        throw new UnauthorisedError('Invalid or expired refresh token');
      }
      handleCognitoError(err, 'refreshToken');
      throw err; // This line won't be reached due to handleCognitoError throwing
    }
  }

  async inviteUser(
    email: string,
    firstName: string,
    lastName: string,
    userData: Map<string, any> | undefined,
    env: Environment,
    cb: InviteUserCallback
  ): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
      });

      const userAttrs = [
        {
          Name: 'email',
          Value: email,
        },
        {
          Name: 'email_verified',
          Value: 'true',
        },
        {
          Name: 'given_name',
          Value: firstName,
        },
        {
          Name: 'family_name',
          Value: lastName,
        },
      ];

      if (userData) {
        userData.forEach((v: any, k: string) => {
          userAttrs.push({ Name: k, Value: String(v) });
        });
      }

      let userExists = false;
      try {
        const getUserCommand = new AdminGetUserCommand({
          UserPoolId: this.fetchUserPoolId(),
          Username: email,
        });
        await client.send(getUserCommand);
        userExists = true;
        logger.debug(`User ${email} already exists, will resend invitation`);
      } catch (err: any) {
        if (err.name !== 'UserNotFoundException') {
          throw err;
        }
        logger.debug(`User ${email} does not exist, will create new user`);
      }

      const command = new AdminCreateUserCommand({
        UserPoolId: this.fetchUserPoolId(),
        Username: email,
        UserAttributes: userAttrs,
        DesiredDeliveryMediums: ['EMAIL'],
        ...(userExists ? { MessageAction: 'RESEND' } : {}),
      });

      logger.debug(`Attempting to invite user: ${email}`);
      const response = await client.send(command);

      if (response.$metadata.httpStatusCode === 200) {
        logger.info(`User invitation successful for: ${email}`);

        await ensureUser(email, firstName, lastName, env);

        const invitationInfo: InvitationInfo = {
          email: email,
          firstName: firstName,
          lastName: lastName,
          invitationId: response.User?.Username,
          systemInvitationInfo: response,
        };

        cb(invitationInfo);
      } else {
        logger.error(
          `User invitation failed with HTTP status ${response.$metadata.httpStatusCode}`,
          {
            email: email,
            statusCode: response.$metadata.httpStatusCode,
          }
        );
        throw new BadRequestError(
          `User invitation failed with status ${response.$metadata.httpStatusCode}`
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      logger.error(`User invitation error for ${email}:`, {
        errorName: err.name,
        errorMessage: sanitizeErrorMessage(err.message),
      });
      handleCognitoError(err, 'inviteUser');
    }
  }

  async acceptInvitation(
    email: string,
    tempPassword: string,
    newPassword: string,
    _env: Environment
  ): Promise<void> {
    try {
      const client = new CognitoIdentityProviderClient({
        region: process.env.AWS_REGION || 'us-west-2',
        credentials: fromEnv(),
      });

      const initAuth = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.fetchClientId(),
        AuthParameters: {
          USERNAME: email,
          PASSWORD: tempPassword,
        },
      });

      const initResponse = await client.send(initAuth);

      if (initResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        const respond = new RespondToAuthChallengeCommand({
          ClientId: this.fetchClientId(),
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: initResponse.Session,
          ChallengeResponses: {
            USERNAME: email,
            NEW_PASSWORD: newPassword,
          },
        });

        await client.send(respond);
        logger.info(`User invitation accepted successfully for: ${email}`);
      } else {
        throw new Error(`Unexpected challenge: ${initResponse.ChallengeName}`);
      }
    } catch (err: any) {
      logger.error(`Accept invitation failed for ${email}: ${sanitizeErrorMessage(err.message)}`);
      handleCognitoError(err, 'acceptInvitation');
    }
  }

  async callback(code: string, env: Environment, cb: LoginCallback): Promise<void> {
    try {
      if (!isNodeEnv) {
        throw new Error('Callback authentication is only supported in Node.js environment');
      }

      const clientId = this.fetchConfig('ClientId');
      const region = process.env.AWS_REGION || 'us-east-1';
      const redirectUri = process.env.COGNITO_REDIRECT_URI || 'http://localhost:3000/auth/callback';
      const hostedDomain = process.env.COGNITO_HOSTED_DOMAIN;
      const tokenEndpoint = `https://${hostedDomain}.auth.${region}.amazoncognito.com/oauth2/token`;

      const tokenRequestBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code,
        redirect_uri: redirectUri,
      });

      logger.debug(`Exchanging authorization code for tokens via OAuth2 endpoint`);

      console.log('te', tokenEndpoint, tokenRequestBody.toString());
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenRequestBody.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
      }

      const tokenData = await response.json();

      if (!tokenData.access_token || !tokenData.id_token || !tokenData.refresh_token) {
        throw new Error('Missing required tokens in response');
      }

      const {
        access_token: AccessToken,
        id_token: IdToken,
        refresh_token: RefreshToken,
      } = tokenData;

      const idTokenPayload = this.decodeJwtPayload(IdToken);
      const userEmail = idTokenPayload.email;
      const firstName = idTokenPayload['given_name'] || idTokenPayload['name'] || '';
      const lastName = idTokenPayload['family_name'] || '';
      const userGroups = idTokenPayload['cognito:groups'];

      if (!userEmail) {
        throw new Error('Email not found in ID attributes');
      }

      let localUser = await findUserByEmail(userEmail, env);
      if (!localUser) {
        localUser = await ensureUser(userEmail, firstName, lastName, env);
      }
      const userId = localUser.lookup('id');

      if (userGroups) {
        await ensureUserRoles(userId, userGroups, env);
      }

      const localSession = await ensureUserSession(userId, IdToken, AccessToken, RefreshToken, env);

      const sessionInfo: SessionInfo = {
        sessionId: localSession.lookup('id'),
        userId: userId,
        authToken: IdToken,
        idToken: IdToken,
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        systemSesionInfo: tokenData,
      };

      logger.info(`Auth callback successful for user ${userEmail}`);
      cb(sessionInfo);
    } catch (err: any) {
      console.log(err);
      logger.error(`Auth callback failed: ${sanitizeErrorMessage(err.message)}`);
      handleCognitoError(err, 'callback');
    }
  }

  private decodeJwtPayload(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (err) {
      logger.error(`Failed to decode JWT payload: ${err}`);
      throw new Error('Invalid JWT token');
    }
  }
}
