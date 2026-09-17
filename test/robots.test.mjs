/**
 * The politeness layer is the part of this package with a victim if it is
 * wrong, so it is the part with tests. Every case here is a real robots.txt
 * observed on a farm or orchard site while scoping orchard-map.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRobots, allowedBy } from '../node/fetch.mjs'

const UA = 'map-kit-crawler/0.1'

test('an empty Disallow permits everything', () => {
  // applesfromny.com ships exactly this. Reading it as "Disallow: /" would
  // lock us out of the one source that actually has the data.
  const { rules } = parseRobots('User-agent: *\nDisallow:\n', UA)
  assert.equal(allowedBy(rules, '/'), true)
  assert.equal(allowedBy(rules, '/find-apples-og/pick-your-own/'), true)
})

test('a missing robots.txt permits everything', () => {
  const { rules } = parseRobots('', UA)
  assert.equal(allowedBy(rules, '/anything'), true)
})

test('wildcard rules block only what they match', () => {
  // hurdsfamilyfarm.com
  const { rules } = parseRobots(
    'User-agent: *\nAllow: /\nDisallow: *?lightbox=\n', UA)
  assert.equal(allowedBy(rules, '/visit'), true)
  assert.equal(allowedBy(rules, '/gallery?lightbox=abc'), false)
})

test('Crawl-delay is read as seconds', () => {
  // duboisfarms.com asks for 30 and gets 30.
  const { delay } = parseRobots('User-agent: *\nCrawl-delay: 30\n', UA)
  assert.equal(delay, 30)
})

test('a group naming us beats the wildcard group', () => {
  const txt = [
    'User-agent: *',
    'Disallow: /',
    '',
    'User-agent: map-kit-crawler',
    'Allow: /',
    'Disallow: /private',
  ].join('\n')
  const { rules } = parseRobots(txt, UA)
  assert.equal(allowedBy(rules, '/hours'), true)
  assert.equal(allowedBy(rules, '/private/x'), false)
})

test('consecutive User-agent lines share one group', () => {
  const txt = [
    'User-agent: AdsBot-Google',
    'User-agent: map-kit-crawler',
    'Disallow: /nope',
  ].join('\n')
  const { rules } = parseRobots(txt, UA)
  assert.equal(allowedBy(rules, '/nope'), false)
  assert.equal(allowedBy(rules, '/yes'), true)
})

test('a blanket Disallow really does block the host', () => {
  const { rules } = parseRobots('User-agent: *\nDisallow: /\n', UA)
  assert.equal(allowedBy(rules, '/'), false)
  assert.equal(allowedBy(rules, '/hours'), false)
})

test('the longest match wins, and Allow breaks a tie', () => {
  const txt = 'User-agent: *\nDisallow: /farm\nAllow: /farm/hours\n'
  const { rules } = parseRobots(txt, UA)
  assert.equal(allowedBy(rules, '/farm/prices'), false)
  assert.equal(allowedBy(rules, '/farm/hours'), true)
})

test('comments and blank lines are ignored', () => {
  const txt = '# START BLOCK\nUser-agent: *\nDisallow:   # nothing\n\n# END\n'
  const { rules } = parseRobots(txt, UA)
  assert.equal(allowedBy(rules, '/x'), true)
})
