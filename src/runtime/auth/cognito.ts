import { CognitoUserPool, CognitoUserAttribute } from 'amazon-cognito-identity-js';

// Replace with your Cognito details
const poolData = {
  UserPoolId: 'YOUR_USER_POOL_ID',
  ClientId: 'YOUR_APP_CLIENT_ID',
};
const userPool = new CognitoUserPool(poolData);

// Sign-up Functionality
const attributeList = [];
const attributeEmail = new CognitoUserAttribute({
  Name: 'email',
  Value: 'user@example.com',
});
attributeList.push(attributeEmail);

// Example registration
userPool.signUp('username', 'password', attributeList, null, (err, result) => {
  if (err) {
    console.log(err);
    return;
  }
  const cognitoUser = result.user;
  console.log('User registered:', cognitoUser);
});

// Sign-in Functionality
// Example authentication
import { CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

const username = 'username'; // Replace with actual username
const password = 'password'; // Replace with actual password

const user = new CognitoUser({
  Username: username,
  Pool: userPool,
});

const authDetails = new AuthenticationDetails({
  Username: username,
  Password: password,
});

user.authenticateUser(authDetails, {
  onSuccess: (session) => {
    console.log('Session:', session);
    console.log('Access Token:', session.getIdToken().jwtToken);
  },
  onFailure: (err) => {
    console.log('Authentication failed:', err);
  },
});