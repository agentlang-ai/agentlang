import {
  CognitoUserPool,
  CognitoUserAttribute,
  ICognitoUserPoolData,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import {
  Authentication,
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

const poolData = {
  UserPoolId: process.env.COGNITO_USER_POOL_ID,
  ClientId: process.env.COGNITO_CLIENT_ID,
};

export class CognitoAuth implements Authentication {
  private userPool: CognitoUserPool;

  constructor(config?: Map<string, any>) {
    const pd = config ? config.get('cognito') : poolData;
    this.userPool = new CognitoUserPool(pd as ICognitoUserPoolData);
  }

  private static DefaultValidationAttributes = new Array<CognitoUserAttribute>();

  async signUp(
    username: string,
    password: string,
    userData: Map<string, any>,
    cb: SignUpCallback
  ): Promise<void> {
    const attributeList = userData.get('userAttributes') as CognitoUserAttribute[];
    let cognitoUser: CognitoUser | undefined;
    await this.userPool.signUp(
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
      Pool: this.userPool,
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
      Pool: this.userPool,
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
