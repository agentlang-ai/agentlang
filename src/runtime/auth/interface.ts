export type UserInfo = {
  id: string; // a UUID
  username: string;
  systemUserInfo?: any;
};

export type SessionInfo = {
  sessionId: string; // a UUID
  userId: string; // UUID
  authToken: string;
  systemSesionInfo?: any;
};

export type SignUpCallback = (userInfo: UserInfo) => void;
export type LoginCallback = (sessionInfo: SessionInfo) => void;
export type LogoutCallback = (status: boolean) => void;

export interface AgentlangAuth {
  signUp(username: string, password: string, userData: Map<string, any>, cb: SignUpCallback): any;
  login(username: string, password: string, cb: LoginCallback): any;
  logout(sessionInfo: SessionInfo, cb?: LogoutCallback): any;
}
