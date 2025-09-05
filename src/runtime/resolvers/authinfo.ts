export class ResolverAuthInfo {
  userId: string;
  readForUpdate = false;
  readForDelete = false;

  constructor(userId: string, readForUpdate?: boolean, readForDelete?: boolean) {
    this.userId = userId;
    if (readForUpdate != undefined) this.readForUpdate = readForUpdate;
    if (readForDelete != undefined) this.readForDelete = readForDelete;
  }
}

// This user-id is only for testing. Override per session from the HTTP layer.
export const DefaultAuthInfo = new ResolverAuthInfo('9459a305-5ee6-415d-986d-caaf6d6e2828');
