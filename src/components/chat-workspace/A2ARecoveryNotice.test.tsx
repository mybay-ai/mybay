import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import zh from '../../locales/zh-CN/dashboard/base.json';
import en from '../../locales/en/dashboard/base.json';
import { A2ARecoveryNotice, A2ATaskEvidence } from './A2ARecoveryNotice';
import { resolveA2ARecoveryEvidence } from '../../../shared/a2aRecovery';

async function render(source: unknown, status: string, language = 'zh-CN') {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, resources: { 'zh-CN': { dashboard: zh }, en: { dashboard: en } } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><A2ARecoveryNotice source={source} status={status} /></I18nextProvider>);
}
const source = { contextId: 'ctx-original', taskId: 'task-original', peerId: 'peer-original' };

describe('recovery review status boundaries', () => {
  it('labels disk recovery separately and keeps the last remote state non-live', async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { dashboard: zh } } });
    const evidence = resolveA2ARecoveryEvidence(source, [{ ...source, direction: 'outbound', status: 'failed' }]);
    evidence.remoteMapping = { remoteTaskId: 'task-remote', remoteState: 'TASK_STATE_WORKING', recordState: 'uncertain', updatedAt: '', lookupState: 'disk_reply', diskResult: 'exact saved reply' };
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><A2ATaskEvidence evidence={evidence} /></I18nextProvider>);
    expect(html).toContain(zh.a2a.lastRemoteTaskState);
    expect(html).toContain(zh.a2a.remoteLookup.disk_reply);
    expect(html).toContain('exact saved reply');
    expect(html).toContain(`${zh.a2a.originalTaskRecord}: ${zh.a2a.activityStatuses.failed}`);
    expect(html).not.toContain(zh.a2a.remoteMappingRecorded);
  });
  it('renders original failure separately from another successful task', async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { dashboard: zh } } });
    const evidence = resolveA2ARecoveryEvidence(source, [
      { ...source, direction: 'outbound', status: 'agent_offline' },
      { ...source, taskId: 'task-later', direction: 'outbound', status: 'completed' },
    ]);
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><A2ATaskEvidence evidence={evidence} /></I18nextProvider>);
    expect(html).toContain(`${zh.a2a.originalTaskRecord}: ${zh.a2a.activityStatuses.agent_offline}`);
    expect(html).toContain(zh.a2a.otherContextTasks);
    expect(html).toContain('task-later');
    expect(html).toContain(zh.a2a.taskAttributionHint);
  });
  it.each(['zh-CN', 'en'])('does not present a completed review as remote success (%s)', async language => {
    const copy = language === 'en' ? en.a2a : zh.a2a;
    const html = await render(source, 'completed', language);
    expect(html).toContain(copy.checkStages.finished);
    expect(html).toContain(copy.checkFinishedHint);
    expect(html).toContain(source.taskId);
    expect(html).toMatch(/<details\s[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });
  it.each(['failed', 'cancelled', 'running', 'unrecognized'])('keeps %s distinct from review completion', async status => {
    const html = await render(source, status);
    expect(html).not.toContain(zh.a2a.checkStages.finished);
    expect(html).toContain(zh.a2a.checkScopeHint);
  });
  it.each([undefined, {}, { ...source, taskId: '../invalid' }])('does not label ordinary or malformed messages as recovery reviews', async value => {
    expect(await render(value, 'completed')).toBe('');
  });
});
