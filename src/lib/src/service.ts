import { InjectionToken, Injectable, Inject } from '@angular/core';
import { AbTestOptions } from './module';
import { AbTestForRealUser, AbTestForCrawler, CookieHandler, CrawlerDetector, RandomExtractor } from './classes';
import { error } from './error';

export const CONFIG = new InjectionToken<AbTestOptions[]>('ANGULAR_AB_TEST_CONFIG');
export const COOKIE_HANDLER = new InjectionToken<CookieHandler>('ANGULAR_AB_TEST_COOKIE_HANDLER');
export const COOKIE_NAMESPACE = 'angular-ab-test';
export const CRAWLER_DETECTOR = new InjectionToken<CrawlerDetector>('ANGULAR_AB_TEST_CRAWLER_DETECTOR');
export const RANDOM_EXTRACTOR = new InjectionToken<RandomExtractor>('ANGULAR_AB_TEST_RANDOM_EXTRACTOR');

@Injectable()
export class AbTestsService {
  private _tests: { [x: string]: AbTestForRealUser | AbTestForCrawler } = {};
  private _cookieHandler: CookieHandler;
  private _randomExtractor: RandomExtractor;
  private _defaultScope: string = 'default';

  constructor(
    @Inject(CONFIG) configs: AbTestOptions[],
    @Inject(COOKIE_HANDLER) cookieHandler: CookieHandler,
    @Inject(CRAWLER_DETECTOR) crawlerDetector: CrawlerDetector,
    @Inject(RANDOM_EXTRACTOR) randomExtractor: RandomExtractor
  ) {
    this._cookieHandler = cookieHandler;
    this._randomExtractor = randomExtractor;
    var testGeneratorIdentifier: string;
    if (crawlerDetector.isCrawler()) {
      testGeneratorIdentifier = 'setupTestForCrawler';
    } else {
      testGeneratorIdentifier = 'setupTestForRealUser';
    }
    for (let config of configs) {
      let scope: string = this._defaultScope;
      if (!!config.scope) {
        scope = config.scope;
      }
      if (!!this._tests[scope]) {
        error('Test with scope <' + scope + '> cannot be initialized twice');
      }
      this[testGeneratorIdentifier](scope, this.filterVersions(config.versions), config);
    }
  }

  shouldRender(versions: string[], scope: string, forCrawlers: boolean): boolean {
    let scopeOrDefault = scope || this._defaultScope;
    if (!this._tests[scopeOrDefault]) {
      error('Test with scope <' + scopeOrDefault + '> has not been defined');
    }
    return this._tests[scopeOrDefault].shouldRender(versions, forCrawlers);
  }

  private filterVersions(versions: string[]): string[] {
    let resp:string[] = [];
    if (versions.length < 2) {
      error('You have to provide at least two versions');
    }
    for (let version of versions) {
      if (resp.indexOf(version) !== -1) {
        error('Version <' + version + '> is repeated in the array of versions [ ' + versions.join(', ') + ' ]');
      }
      resp.push(version);
    }
    return resp;
  }

  private setupTestForCrawler(scope: string, versions: string[], config: AbTestOptions) {
    if (!!config.versionForCrawlers && versions.indexOf(config.versionForCrawlers) === -1) {
      error('Version for crawlers <' + config.versionForCrawlers + '> is not included in versions [ ' + versions.join(', ') + ' ]');
    }
    this._tests[scope] = new AbTestForCrawler(config.versionForCrawlers);
  }

  private setupTestForRealUser(scope: string, versions: string[], config: AbTestOptions) {
    let chosenVersion: string = this.generateVersion({
      versions: versions,
      cookieName: COOKIE_NAMESPACE + '-' + scope,
      domain: config.domain,
      expiration: config.expiration,
      weights: config.weights,
    });
    this._tests[scope] = new AbTestForRealUser(versions, chosenVersion);
  }

  private generateVersion(config: {
    versions: string[],
    cookieName: string,
    domain?: string,
    expiration?: number,
    weights?: { [x: string]: number };
  }): string {
    let chosenVersion: string = this._cookieHandler.get(config.cookieName);
    if (config.versions.indexOf(chosenVersion) !== -1) {
      return chosenVersion;
    }
    this._randomExtractor.setWeights(this.processWeights(config.weights || {}, config.versions));
    chosenVersion = this._randomExtractor.run();
    this._cookieHandler.set(config.cookieName, chosenVersion, config.domain, config.expiration);
    return chosenVersion;
  }

  private processWeights(weights: { [x: string]: number }, versions: string[]): [number, string][] {
    let processedWeights: [number, string][] = [];
    let totalWeight: number = 0;
    let tempVersions: string[] = versions.slice(0);
    let index: number;
    for (let key in weights) {
      index = tempVersions.indexOf(key);
      if (index === -1) {
        error('Weight associated to <' + key + '> which is not included in versions [ ' + versions.join(', ') + ' ]');
      }
      tempVersions.splice(index, 1);
      totalWeight += this.roundFloat(weights[key]);
      processedWeights.push([totalWeight, key]);
    }
    if (totalWeight >= 100) {
      error('Sum of weights is <' + totalWeight + '>, while it should be less than 100');
    }
    let remainingWeight: number = this.roundFloat((100 - totalWeight) / tempVersions.length);
    for (let version of tempVersions) {
      totalWeight += remainingWeight;
      processedWeights.push([totalWeight, version]);
    }
    processedWeights[processedWeights.length - 1] = [100, processedWeights[processedWeights.length - 1][1]];
    return processedWeights;
  }

  private roundFloat(x: number): number {
    return Math.round(x * 10) / 10;
  }
}