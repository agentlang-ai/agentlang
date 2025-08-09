import { Environment } from '../interpreter.js';

export type UserInfo = {
  id: string; // a UUID
  username: string;
  systemUserInfo?: any;
};

export type SessionInfo = {
  sessionId: string; // a UUID
  userId: string; // UUID
  authToken: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  systemSesionInfo?: any;
};

export type SignUpCallback = (userInfo: UserInfo) => void;
export type LoginCallback = (sessionInfo: SessionInfo) => void;
export type LogoutCallback = (status: boolean) => void;

export interface AgentlangAuth {
  signUp(
    firstName: string,
    lastName: string,
    username: string,
    password: string,
    userData: Map<string, any> | undefined,
    env: Environment,
    cb: SignUpCallback
  ): any;
  confirmSignup(username: string, confirmationCode: string, env: Environment): Promise<void>;
  forgotPassword(username: string, env: Environment): Promise<void>;
  confirmForgotPassword(
    username: string,
    confirmationCode: string,
    newPassword: string,
    env: Environment
  ): Promise<void>;
  login(username: string, password: string, env: Environment, cb: LoginCallback): any;
  logout(sessionInfo: SessionInfo, env: Environment, cb?: LogoutCallback): any;
  verifyToken(token: string, env?: Environment): any;
  getUser(userId: string, env: Environment): Promise<UserInfo>;
  getUserByEmail(email: string, env: Environment): Promise<UserInfo>;
  changePassword(
    sessionInfo: SessionInfo,
    newPassword: string,
    oldPassword: string,
    env: Environment
  ): Promise<boolean>;
  refreshToken(refreshToken: string, env: Environment): Promise<SessionInfo>;
}
