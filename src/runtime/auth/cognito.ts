import {
  CognitoUserPool,
  CognitoUserAttribute,
  ICognitoUserPoolData,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
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
/*import { fromEnv } from "@aws-sdk/credential-providers";
import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";*/

const poolData = {
  UserPoolId: process.env.COGNITO_USER_POOL_ID,
  ClientId: process.env.COGNITO_CLIENT_ID,
};

export class CognitoAuth implements AgentlangAuth {
  private userPool: CognitoUserPool | undefined;

  constructor(config?: Map<string, any>) {
    const pd = config ? config.get('cognito') : poolData;
    if (pd.UserPoolId && pd.ClientId) {
      this.userPool = new CognitoUserPool(pd as ICognitoUserPoolData);
    }
  }

  private static DefaultValidationAttributes = new Array<CognitoUserAttribute>();

  private fetchUserPool(): CognitoUserPool {
    if (!this.userPool) {
      throw new Error(`User-pool not inited`);
    }
    return this.userPool;
  }

  async signUp(
    username: string,
    password: string,
    userData: Map<string, string>,
    cb: SignUpCallback
  ): Promise<void> {
    const attributeList = userDataAsCognitoAttributes(userData.set('email', username));
    let cognitoUser: CognitoUser | undefined;
    const userPool: CognitoUserPool = this.fetchUserPool();
    await userPool.signUp(
      username,
      password,
      attributeList,
      CognitoAuth.DefaultValidationAttributes,
      (err: any, result: any) => {
        if (err) {
          throw new Error(`Failed to signup ${username} - ${err}`);
        }
        if (result) {
          cognitoUser = result.user;
          console.log('User registered:', cognitoUser);
        } else {
          throw new Error(`Failed to signup ${username}`);
        }
      }
    );
    if (cognitoUser) {
      const user = await ensureUser(
        cognitoUser.getUsername(),
        findAttributeValue(attributeList, 'firstName', ''),
        findAttributeValue(attributeList, 'lastName', '')
      );
      const userInfo: UserInfo = {
        username: username,
        id: user.id,
        systemUserInfo: cognitoUser,
      };
      cb(userInfo);
    } else {
      throw new Error(`Failed to signup ${username}`);
    }
  }

  async login(username: string, password: string, cb: LoginCallback): Promise<void> {
    const localUser = await findUserByEmail(username);
    if (!localUser) {
      throw new Error(`User not found ${username}`);
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
    await user.authenticateUser(authDetails, {
      onSuccess: session => {
        result = session;
      },
      onFailure: err => {
        throw new Error(`Authentication failed for ${username} - ${err}`);
      },
    });
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
      throw new Error(`Login failed for ${username}`);
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
    await user.signOut();
    const sess = await findUserSession(localUser.id);
    if (sess) {
      await removeSession(sess.id);
    }
    if (cb) cb(true);
  }
}

function findAttributeValue(
  attrs: CognitoUserAttribute[],
  name: string,
  notFoundValue: string
): string {
  const ca: CognitoUserAttribute | undefined = attrs.find((ca: CognitoUserAttribute) => {
    return ca.getName() == name;
  });
  if (ca) {
    return ca.getValue();
  } else {
    return notFoundValue;
  }
}

function userDataAsCognitoAttributes(userData: Map<string, string>): CognitoUserAttribute[] {
  const result: CognitoUserAttribute[] = [];
  userData.forEach((v: string, k: string) => {
    const ca = new CognitoUserAttribute({ Name: k, Value: v });
    result.push(ca);
  });
  return result;
}
/*
export async function congitoTest() {
  const client = new CognitoIdentityProviderClient({ region: "us-west-2", credentials: fromEnv() });
  const input = { // AdminGetUserRequest
    UserPoolId: "us-west-2_Piy14iUPZ", // required
    Username: "vijay@fractl.io", // required
  };
  const command = new AdminGetUserCommand(input);
  const response = await client.send(command);
  console.log(response)
}
*/
