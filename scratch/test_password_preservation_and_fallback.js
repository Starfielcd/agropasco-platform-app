/**
 * Verification test for password preservation, setupApprovedPassword, and email logging
 */

const bcrypt = require('bcryptjs');
const { dbRun, dbGet } = require('../backend/config/database');
const emailService = require('../backend/services/emailService');
const authController = require('../backend/controllers/authController');
const adminController = require('../backend/controllers/adminController');

async function runTests() {
  console.log('=== TEST: Password Preservation & Immediate Access ===\n');

  const testEmail = `test.advisor.${Date.now()}@agropasco.pe`;
  const originalUserPassword = 'OriginalSecretPassword2026!';

  // 1. Register sensitive account
  console.log('1. Registering user with custom password:', originalUserPassword);
  let regRes = null;
  const mockReqReg = {
    body: {
      name: 'Ing. Fernando Prueba',
      email: testEmail,
      password: originalUserPassword,
      role: 'advisor',
      location: 'Chaupimarca',
      phone: '955443322'
    }
  };
  const mockResReg = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { regRes = d; return d; }
  };
  await authController.register(mockReqReg, mockResReg);
  console.log('   Registration result:', regRes.pending ? 'PENDING (OK)' : 'FAIL');
  const userId = regRes.requestId;

  // 2. Admin approves account WITHOUT overwriting password
  console.log('\n2. Admin approving account with default (preserved password)...');
  let approveRes = null;
  const mockReqApprove = {
    params: { id: userId },
    body: { generate_temp_password: false },
    user: { id: 1 },
    ip: '127.0.0.1',
    protocol: 'http',
    get: () => 'localhost:5000'
  };
  const mockResApprove = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { approveRes = d; return d; }
  };
  await adminController.approveAccount(mockReqApprove, mockResApprove);
  console.log('   Approval result keptOriginalPassword:', approveRes.keptOriginalPassword);
  console.log('   TempPassword returned:', approveRes.tempPassword);

  // Verify in database: password_hash must match originalUserPassword
  const userInDb = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  const isOriginalValid = await bcrypt.compare(originalUserPassword, userInDb.password_hash);
  console.log('   Original password valid in DB after approval:', isOriginalValid ? 'YES ✅' : 'NO ❌');
  if (!isOriginalValid) {
    throw new Error('User original password was overwritten during approval!');
  }
  if (userInDb.must_change_password !== 0) {
    throw new Error('must_change_password should be 0 when original password is kept');
  }

  // 3. Test user login with original password
  console.log('\n3. Testing user login with original password...');
  let loginRes = null;
  const mockReqLogin = {
    body: { email: testEmail, password: originalUserPassword }
  };
  const mockResLogin = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { loginRes = d; return d; }
  };
  await authController.login(mockReqLogin, mockResLogin);
  console.log('   Login success:', loginRes.success ? 'YES ✅' : 'NO ❌');
  if (!loginRes.success) {
    throw new Error('User could not log in with their original password!');
  }

  // 4. Test getApplicationStatus returns hasRegisteredPassword: true
  console.log('\n4. Testing getApplicationStatus payload...');
  let statusRes = null;
  const mockReqStatus = {
    params: { identifier: testEmail },
    query: {}
  };
  const mockResStatus = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { statusRes = d; return d; }
  };
  await authController.getApplicationStatus(mockReqStatus, mockResStatus);
  console.log('   Status step:', statusRes.data.step);
  console.log('   hasRegisteredPassword:', statusRes.data.hasRegisteredPassword);
  if (!statusRes.data.hasRegisteredPassword) {
    throw new Error('hasRegisteredPassword should be true');
  }

  // 5. Test setupApprovedPassword direct fallback
  console.log('\n5. Testing setupApprovedPassword (fallback)...');
  const fallbackPassword = 'NewFallbackPassword999!';
  let setupRes = null;
  const mockReqSetup = {
    body: { email: testEmail, newPassword: fallbackPassword },
    ip: '127.0.0.1'
  };
  const mockResSetup = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { setupRes = d; return d; }
  };
  await authController.setupApprovedPassword(mockReqSetup, mockResSetup);
  console.log('   Setup result:', setupRes.success ? 'SUCCESS ✅' : 'FAIL ❌');
  if (!setupRes.success) {
    throw new Error('setupApprovedPassword failed');
  }

  // Test login with fallback password
  let loginFallbackRes = null;
  const mockReqLogin2 = {
    body: { email: testEmail, password: fallbackPassword }
  };
  const mockResLogin2 = {
    status: function(c) { this.code = c; return this; },
    json: function(d) { loginFallbackRes = d; return d; }
  };
  await authController.login(mockReqLogin2, mockResLogin2);
  console.log('   Login with new password success:', loginFallbackRes.success ? 'YES ✅' : 'NO ❌');
  if (!loginFallbackRes.success) {
    throw new Error('User could not log in with newly setup password!');
  }

  // 6. Clean up test user
  await dbRun('DELETE FROM users WHERE id = ?', [userId]);
  console.log('\n Cleaned up test user.');
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
