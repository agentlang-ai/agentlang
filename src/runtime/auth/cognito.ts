import {
  CognitoUserPool,
  CognitoUserAttribute,
  ICognitoUserPoolData,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: process.env.COGNITO_USER_POOL_ID,
  ClientId: process.env.COGNITO_CLIENT_ID,
};

export class CognitoAuth {
  private userPool: any;

  constructor(config?: Map<string, any>) {
    const pd = config ? config.get('cognito') : poolData;
    this.userPool = new CognitoUserPool(pd as ICognitoUserPoolData);
  }

  private static DefaultValidationAttributes = new Array<CognitoUserAttribute>();

  async signUp(username: string, password: string, userData: Map<string, any>): Promise<any> {
    const attributeList = userData.get('userAttributes') as CognitoUserAttribute[];
    let cognitoUser: any;
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
    return cognitoUser;
  }

  async signin(username: string, password: string): Promise<CognitoUserSession | undefined> {
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
        console.log('Session:', session);
        console.log('Access Token:', session.getIdToken().getJwtToken());
        result = session;
      },
      onFailure: err => {
        throw new Error(`Authentication failed for ${username} - ${err}`);
      },
    });
    return result;
  }
}
