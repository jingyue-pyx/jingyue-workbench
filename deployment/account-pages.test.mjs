import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { accountPage } from './account-pages.mjs';

test('register form submits three distinct fields, preserves error feedback, and never asks for phone/email', async () => {
  const calls = [];
  const { html } = accountPage('register', { registrationOpen: true });
  const dom = new JSDOM(html, {
    url: 'https://workbench.example/register',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (path, options) => {
        calls.push({ path, options });
        return { ok: false, json: async () => ({ error: { message: '该账号已被使用。' } }) };
      };
    },
  });
  const document = dom.window.document;
  const form = document.querySelector('form');
  form.elements.displayName.value = '可修改的名字';
  form.elements.username.value = 'immutable_account';
  form.elements.password.value = 'Local-test-password-7248';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/auth/register');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: '可修改的名字',
    username: 'immutable_account',
    password: 'Local-test-password-7248',
  });
  assert.equal(document.querySelector('#feedback').textContent, '该账号已被使用。');
  assert.equal(document.querySelector('#submit').disabled, false);
  assert.equal(document.querySelectorAll('input[type="tel"],input[type="email"]').length, 0);
  const reveal = document.querySelector('.reveal');
  reveal.click();
  assert.equal(form.elements.password.type, 'text');
  reveal.click();
  assert.equal(form.elements.password.type, 'password');
  dom.window.close();
});
test('profile keeps account disabled and submits only display name with expected session identity', async () => {
  const user = {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    username: 'fixed_account',
    displayName: '原来的名字',
    legacyOwner: false,
  };
  const calls = [];
  const { html } = accountPage('account', { registrationOpen: true, user });
  const dom = new JSDOM(html, {
    url: 'https://workbench.example/account',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (path, options) => {
        calls.push({ path, options });
        return { ok: true, json: async () => ({ user: { ...user, displayName: '新名字' } }) };
      };
    },
  });
  const form = dom.window.document.querySelector('form');
  assert.equal(form.elements.username.disabled, true);
  assert.equal(form.elements.username.value, user.username);
  form.elements.displayName.value = '新名字';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].path, '/api/auth/profile');
  assert.equal(calls[0].options.headers['X-Jingyue-User'], user.id);
  assert.deepEqual(JSON.parse(calls[0].options.body), { displayName: '新名字' });
  assert.match(dom.window.document.querySelector('#feedback').textContent, /显示名已更新/);
  dom.window.close();
});
test('user text cannot terminate bootstrap script or create injected elements', () => {
  const label = '</script><div id="injected">not markup</div>';
  const { html } = accountPage('account', {
    registrationOpen: false,
    user: { id: 'test', username: 'fixed', displayName: label },
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  assert.equal(dom.window.document.querySelector('#injected'), null);
  assert.equal(dom.window.document.querySelector('#display-name').value, label);
  dom.window.close();
});
