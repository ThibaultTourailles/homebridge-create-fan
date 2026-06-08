import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { FanAccessory, LightAccessory } from './accessory.js';

export interface FanConfiguration {
  id: string;
  key: string;
  name: string;
  ip: string;
  version: number;
}
export type PlatformAccessoryContext = { device: FanConfiguration };


export class HomebridgeCreateCeilingFan implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory<PlatformAccessoryContext>> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log.debug('Platform:', `Finished initializing platform ${this.config.name}`);

    this.api.on('didFinishLaunching', () => {
      log.debug('Platform:', 'Executed didFinishLaunching callback');
      if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
        this.log.warn('No fans specified in the configuration.');
        return;
      }
      this.discoverDevices(config.devices);
    });
  }

  discoverDevices(fans: FanConfiguration[]) {
    for (const fan of fans) {
      const fanUUID = this.api.hap.uuid.generate(fan.id + '-fan');
      const lightUUID = this.api.hap.uuid.generate(fan.id + '-light');

      const fanAcc = this.getOrCreateAccessory(fanUUID, fan.name, fan);
      const lightAcc = this.getOrCreateAccessory(lightUUID, `${fan.name} Light`, fan);

      const fanAccessory = new FanAccessory(this, fanAcc);
      new LightAccessory(this, lightAcc, fanAccessory);

      this.discoveredCacheUUIDs.push(fanUUID, lightUUID);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Platform:', 'Removing accessory from cache ->', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  private getOrCreateAccessory(uuid: string, name: string, fan: FanConfiguration) {
    const existing = this.accessories.get(uuid);
    if (existing) {
      this.log.info('Platform:', `Restoring existing accessory from cache -> ${existing.displayName}`);
      existing.context.device = fan;
      return existing;
    }
    this.log.info('Platform:', `Adding new accessory -> ${name}`);
    const accessory = new this.api.platformAccessory<PlatformAccessoryContext>(name, uuid);
    accessory.context.device = fan;
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    return accessory;
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Platform:', 'Loading accessory from cache ->', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<PlatformAccessoryContext>);
  }
}
