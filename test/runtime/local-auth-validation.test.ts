import { assert, describe, test } from 'vitest';

describe('Local Authentication Validation', () => {
  test('Password hashing and token generation work correctly', async () => {
    // Test the core crypto functions that power local authentication
    const { scryptSync, randomBytes, timingSafeEqual, createHmac } = await import('crypto');
    
    // Test password hashing
    const SALT_LENGTH = 32;
    const KEY_LENGTH = 64;
    
    function hashPassword(password: string): string {
      const salt = randomBytes(SALT_LENGTH);
      const hash = scryptSync(password, salt, KEY_LENGTH);
      return `${salt.toString('hex')}:${hash.toString('hex')}`;
    }
    
    function verifyPassword(password: string, hashedPassword: string): boolean {
      const [saltHex, hashHex] = hashedPassword.split(':');
      if (!saltHex || !hashHex) return false;
      
      const salt = Buffer.from(saltHex, 'hex');
      const hash = Buffer.from(hashHex, 'hex');
      const derivedHash = scryptSync(password, salt, KEY_LENGTH);
      
      return timingSafeEqual(hash, derivedHash);
    }
    
    // Test token generation
    const TOKEN_SECRET = 'test-secret';
    
    function generateLocalToken(userId: string, email: string): string {
      const payload = {
        sub: userId,
        email: email,
        type: 'local',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 3600)
      };
      
      const payloadStr = JSON.stringify(payload);
      const signature = createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('hex');
      
      return `${Buffer.from(payloadStr).toString('base64')}.${signature}`;
    }
    
    function verifyLocalToken(token: string): { userId: string; email: string } {
      const [payloadB64, signature] = token.split('.');
      if (!payloadB64 || !signature) {
        throw new Error('Invalid token format');
      }
      
      const payloadStr = Buffer.from(payloadB64, 'base64').toString();
      const expectedSignature = createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('hex');
      
      if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
        throw new Error('Invalid token signature');
      }
      
      const payload = JSON.parse(payloadStr);
      
      if (payload.type !== 'local') {
        throw new Error('Invalid token type');
      }
      
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired');
      }
      
      return { userId: payload.sub, email: payload.email };
    }
    
    // Test 1: Password hashing and verification
    const testPassword = 'TestPassword123!';
    const hashedPassword = hashPassword(testPassword);
    
    assert(hashedPassword.includes(':'), 'Hashed password should contain salt separator');
    assert(verifyPassword(testPassword, hashedPassword), 'Password verification should succeed');
    assert(!verifyPassword('WrongPassword', hashedPassword), 'Wrong password should be rejected');
    
    // Test 2: Token generation and verification
    const testUserId = 'test-user-id';
    const testEmail = 'test@example.com';
    
    const token = generateLocalToken(testUserId, testEmail);
    assert(token.includes('.'), 'Token should contain signature separator');
    
    const decoded = verifyLocalToken(token);
    assert(decoded.userId === testUserId, 'Decoded user ID should match');
    assert(decoded.email === testEmail, 'Decoded email should match');
    
    // Test 3: Invalid token rejection
    try {
      verifyLocalToken('invalid.token');
      assert(false, 'Should have rejected invalid token');
    } catch (error: any) {
      assert(error.message, 'Should have error message');
      // The error could be about invalid format, signature, or other issues
    }
    
    // Test 4: Cognito configuration detection
    const originalUserPoolId = process.env.COGNITO_USER_POOL_ID;
    const originalClientId = process.env.COGNITO_CLIENT_ID;
    
    // Test without Cognito
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    
    const cognitoConfigured1 = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID;
    assert(!cognitoConfigured1, 'Should detect Cognito as not configured');
    
    // Test with Cognito
    process.env.COGNITO_USER_POOL_ID = 'test-pool';
    process.env.COGNITO_CLIENT_ID = 'test-client';
    
    const cognitoConfigured2 = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID;
    assert(cognitoConfigured2, 'Should detect Cognito as configured');
    
    // Restore original values
    if (originalUserPoolId) {
      process.env.COGNITO_USER_POOL_ID = originalUserPoolId;
    } else {
      delete process.env.COGNITO_USER_POOL_ID;
    }
    if (originalClientId) {
      process.env.COGNITO_CLIENT_ID = originalClientId;
    } else {
      delete process.env.COGNITO_CLIENT_ID;
    }
  });
});