//
// Copyright © TraceX SAS 2026
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { isSafeSecurityPolicyModuleSpecifier, NoopPolicyEngine } from '../securityPolicy'

describe('isSafeSecurityPolicyModuleSpecifier', () => {
  it('accepts scoped and unscoped package names', () => {
    expect(isSafeSecurityPolicyModuleSpecifier('@acme/security-policy')).toBe(true)
    expect(isSafeSecurityPolicyModuleSpecifier('my-security-policy')).toBe(true)
  })

  it('accepts at most one extra path segment after the package name', () => {
    expect(isSafeSecurityPolicyModuleSpecifier('@acme/security-policy/engine')).toBe(true)
    expect(isSafeSecurityPolicyModuleSpecifier('my-security-policy/sub')).toBe(true)
  })

  it('rejects more than one subpath segment', () => {
    expect(isSafeSecurityPolicyModuleSpecifier('@acme/security-policy/a/b')).toBe(false)
    expect(isSafeSecurityPolicyModuleSpecifier('my-security-policy/a/b')).toBe(false)
  })

  it('rejects path traversal and absolute paths', () => {
    expect(isSafeSecurityPolicyModuleSpecifier('../evil')).toBe(false)
    expect(isSafeSecurityPolicyModuleSpecifier('@scope/../../evil')).toBe(false)
    expect(isSafeSecurityPolicyModuleSpecifier('/tmp/evil')).toBe(false)
    expect(isSafeSecurityPolicyModuleSpecifier('.\\evil')).toBe(false)
  })

  it('rejects file and remote URL schemes', () => {
    expect(isSafeSecurityPolicyModuleSpecifier('file:///tmp/x')).toBe(false)
    expect(isSafeSecurityPolicyModuleSpecifier('https://example.com/x')).toBe(false)
  })
})

describe('NoopPolicyEngine country heuristics', () => {
  it('does not flag new_country when there is no geo baseline yet', async () => {
    const engine = new NoopPolicyEngine()
    const result = await engine.evaluateEvent({
      event: {
        accountUuid: 'acc-1' as any,
        eventTime: 1,
        country: 'DE',
        success: true,
        authMethod: 'password'
      } as any,
      recentHistory: [
        {
          accountUuid: 'acc-1' as any,
          eventTime: 0,
          success: true,
          authMethod: 'password'
        } as any
      ]
    })
    expect(result.anomalyCodes).not.toContain('new_country_for_account')
  })

  it('flags new_country when baseline exists and country is new', async () => {
    const engine = new NoopPolicyEngine()
    const result = await engine.evaluateEvent({
      event: {
        accountUuid: 'acc-1' as any,
        eventTime: 2,
        country: 'FR',
        success: true,
        authMethod: 'password'
      } as any,
      recentHistory: [
        {
          accountUuid: 'acc-1' as any,
          eventTime: 1,
          country: 'DE',
          success: true,
          authMethod: 'password'
        } as any
      ]
    })
    expect(result.anomalyCodes).toContain('new_country_for_account')
  })
})
