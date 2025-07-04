import {
  AgentlangAuth,
  LoginCallback,
  LogoutCallback,
  SessionInfo,
  SignUpCallback,
  UserInfo,
} from './interface.js';
import {
  ensureUser,
  ensureUserSession,
  findUser,
  findUserByEmail,
  findUserSession,
  removeSession,
} from '../modules/auth.js';
import { logger } from '../logger.js';
import { sleepMilliseconds } from '../util.js';
import { Instance } from '../module.js';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Environment } from '../interpreter.js';
import { isNodeEnv } from '../../utils/runtime.js';
import { UnauthorisedError } from '../defs.js';

let fromEnv: any = undefined;
let CognitoIdentityProviderClient: any = undefined;
let SignUpCommand: any = undefined;
let AuthenticationDetails: any = undefined;
let CognitoUser: any = undefined;
let CognitoUserPool: any = undefined;

if (isNodeEnv) {
  const cp = await import('@aws-sdk/credential-providers');
  fromEnv = cp.fromEnv;

  const cip = await import('@aws-sdk/client-cognito-identity-provider');
  CognitoIdentityProviderClient = cip.CognitoIdentityProviderClient;
  SignUpCommand = cip.SignUpCommand;

  const ci = await import('amazon-cognito-identity-js');
  AuthenticationDetails = ci.AuthenticationDetails;
  CognitoUser = ci.CognitoUser;
  CognitoUserPool = ci.CognitoUserPool;
}

const defaultConfig = isNodeEnv
  ? new Map<string, string | undefined>()
      .set('UserPoolId', process.env.COGNITO_USER_POOL_ID)
      .set('ClientId', process.env.COGNITO_CLIENT_ID)
  : new Map();

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
    const response = await client.send(command);
    if (response.$metadata.httpStatusCode == 200) {
      const user = await ensureUser(username, '', '', env);
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

  async login(
    username: string,
    password: string,
    env: Environment,
    cb: LoginCallback
  ): Promise<void> {
    let localUser = await findUserByEmail(username, env);
    if (!localUser) {
      logger.warn(`User ${username} not found in local store`);
      localUser = await ensureUser(username, '', '', env);
    }
    const user = new CognitoUser({
      Username: username,
      Pool: this.fetchUserPool(),
    });
    const authDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });
    let result: any;
    let errMsg: string | undefined;
    user.authenticateUser(authDetails, {
      onSuccess: (session: any) => {
        result = session;
      },
      onFailure: (err: any) => {
        errMsg = `Authentication failed for ${username} - ${err}`;
      },
    });
    while (result == undefined && errMsg == undefined) {
      await sleepMilliseconds(100);
    }
    if (errMsg) {
      throw new UnauthorisedError(errMsg);
    }
    if (result) {
      const userid = localUser.lookup('id');
      const token = result.getIdToken().getJwtToken();
      const localSess: Instance = await ensureUserSession(userid, token, env);
      const sessInfo: SessionInfo = {
        sessionId: localSess.lookup('id'),
        userId: userid,
        authToken: token,
        systemSesionInfo: result,
      };
      cb(sessInfo);
    } else {
      console.log(`Login failed for ${username}`);
    }
  }

  async logout(sessionInfo: SessionInfo, env: Environment, cb?: LogoutCallback): Promise<void> {
    const localUser = await findUser(sessionInfo.userId, env);
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
    const sess = await findUserSession(localUser.id, env);
    if (sess) {
      await removeSession(sess.id, env);
    }
    if (cb) cb(true);
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
    } catch (err) {
      throw new Error(`Failed to verify token - ${err}`);
    }
  }
}
