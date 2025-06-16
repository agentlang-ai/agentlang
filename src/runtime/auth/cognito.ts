import {
  AgentlangAuth,
  LoginCallback,
  LogoutCallback,
  SessionInfo,
  SignUpCallback,
  UserInfo,
} from './interface.js';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  SignUpCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromEnv } from '@aws-sdk/credential-providers';
import {
  ensureUser,
  ensureUserSession,
  findUser,
  findUserByEmail,
  findUserSession,
  removeSession,
} from '../modules/auth.js';
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { logger } from '../logger.js';
import { sleepMilliseconds } from '../util.js';

const defaultConfig = new Map<string, string | undefined>()
  .set('UserPoolId', process.env.COGNITO_USER_POOL_ID)
  .set('ClientId', process.env.COGNITO_CLIENT_ID);

export class CognitoAuth implements AgentlangAuth {
  config: Map<string, string | undefined>;
  userPool: CognitoUserPool | undefined;
  constructor(config?: Map<string, string>) {
    this.config = config ? config : defaultConfig;
    const upid = this.config.get('UserPoolId');
    if (upid)
      this.userPool = new CognitoUserPool({
        UserPoolId: this.config.get('UserPoolId') || '',
        ClientId: this.config.get('ClientId') || '',
      });
  }

  async signUp(
    username: string,
    password: string,
    userData: Map<string, string>,
    cb: SignUpCallback
  ): Promise<void> {
    const client = new CognitoIdentityProviderClient({
      region: 'us-west-2',
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
    ];
    const input = {
      ClientId: this.config.get('ClientId'),
      Username: username,
      Password: password,
      UserAttributes: userAttrs,
      ValidationData: userAttrs,
    };
    const command = new SignUpCommand(input);
    const response: SignUpCommandOutput = await client.send(command);
    if (response.$metadata.httpStatusCode == 200) {
      const user = await ensureUser(username, '', '');
      const userInfo: UserInfo = {
        username: username,
        id: user.id,
        systemUserInfo: response.UserSub,
      };
      cb(userInfo);
    } else {
      throw new Error(`Signup failed with status ${response.$metadata.httpStatusCode}`);
    }
  }

  async login(username: string, password: string, cb: LoginCallback): Promise<void> {
    let localUser = await findUserByEmail(username);
    if (!localUser) {
      logger.warn(`User ${username} not found in local store`);
      localUser = await ensureUser(username, '', '');
    }
    const user = new CognitoUser({
      Username: username,
      Pool: this.fetchUserPool(),
    });
    const authDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });
    let result: CognitoUserSession | undefined;
    user.authenticateUser(authDetails, {
      onSuccess: session => {
        result = session;
      },
      onFailure: err => {
        throw new Error(`Authentication failed for ${username} - ${err}`);
      },
    });
    while (result == undefined) {
      await sleepMilliseconds(100);
    }
    if (result) {
      const localSess = await ensureUserSession(localUser.id);
      const sessInfo: SessionInfo = {
        sessionId: localSess.id,
        userId: localUser.id,
        authToken: result.getIdToken().getJwtToken(),
        systemSesionInfo: result,
      };
      cb(sessInfo);
    } else {
      console.log(`Login failed for ${username}`);
    }
  }

  async logout(sessionInfo: SessionInfo, cb?: LogoutCallback): Promise<void> {
    const localUser = await findUser(sessionInfo.userId);
    if (!localUser) {
      if (cb) cb(true);
      return;
    }
    const user = new CognitoUser({
      Username: localUser.email,
      Pool: this.fetchUserPool(),
    });
    let done = false;
    user.signOut(() => {
      done = true;
    });
    while (!done) {
      await sleepMilliseconds(100);
    }
    const sess = await findUserSession(localUser.id);
    if (sess) {
      await removeSession(sess.id);
    }
    if (cb) cb(true);
  }

  private fetchUserPool(): CognitoUserPool {
    if (this.userPool) {
      return this.userPool;
    }
    throw new Error('UserPool not initialized');
  }
}
