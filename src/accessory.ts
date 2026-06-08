import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

// HomeKit colour temperature range in Mireds (153=cool/white, 370=warm)
// 3 discrete steps: 153 (white), 261 (warm white), 369 (warm)
const CCT_MIN_MIREDS = 153;
const CCT_MAX_MIREDS = 370;
const CCT_STEP = 108;

export class FanAccessory {
  public readonly tuyaDevice: TuyaDevice;
  private readonly fanService: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private isConnecting = false;
  private isConnected = false;
  private fanState = {
    Active: 0 as CharacteristicValue,
    Rotation: 0 as CharacteristicValue,
    Speed: 20,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
  ) {
    this.Characteristic = this.platform.Characteristic;
    this.log = this.platform.log;

    this.log.info(`${accessory.displayName}:`, 'Init...');

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id);

    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);
    this.fanService.getCharacteristic(this.Characteristic.Active)
      .onGet(this.getFanActivity.bind(this))
      .onSet(this.setFanActivity.bind(this));
    this.fanService.getCharacteristic(this.Characteristic.RotationDirection)
      .onGet(this.getFanRotation.bind(this))
      .onSet(this.setFanRotation.bind(this));
    this.fanService.getCharacteristic(this.Characteristic.RotationSpeed)
      .onGet(this.getFanSpeed.bind(this))
      .onSet(this.setFanSpeed.bind(this))
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 });

    this.tuyaDevice = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      ip: accessory.context.device.ip,
      version: accessory.context.device.version,
    });
    this.tuyaDevice.on('disconnected', () => {
      this.log.info(`${this.accessory.displayName}:`, 'Disconnected');
      this.isConnected = false;
      this.connect();
    });
    this.tuyaDevice.on('connected', () => {
      this.log.info(`${this.accessory.displayName}:`, 'Connected!');
      this.isConnected = true;
    });
    this.tuyaDevice.on('error', (error: Error) => this.log.warn(`${this.accessory.displayName}:`, `Error -> ${error.toString()}`));
    this.connect();
  }

  async connect() {
    if (this.isConnecting || this.isConnected) {
      return;
    }
    this.isConnecting = true;
    this.log.info(`${this.accessory.displayName}:`, 'Connecting...');
    try {
      await this.tuyaDevice.find();
      await this.tuyaDevice.connect();
    } catch (error) {
      this.log.warn(`${this.accessory.displayName}:`, `Connection failed: ${(error as Error).message}. Retrying in 30s...`);
      this.isConnecting = false;
      setTimeout(() => this.connect(), 30_000);
      return;
    }
    this.isConnecting = false;
  }

  sendCommand(dps: number, value: string | number | boolean) {
    this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
    this.tuyaDevice.set({ dps, set: value, shouldWaitForResponse: false });
  }

  getFanActivity() {
    return this.fanState.Active;
  }

  setFanActivity(value: CharacteristicValue) {
    this.fanState.Active = value as number;
    this.sendCommand(60, this.fanState.Active === 1);
  }

  getFanRotation() {
    return this.fanState.Rotation;
  }

  setFanRotation(value: CharacteristicValue) {
    this.fanState.Rotation = value as number;
    this.sendCommand(63, this.fanState.Rotation === 0 ? 'forward' : 'reverse');
  }

  getFanSpeed() {
    return this.fanState.Speed;
  }

  setFanSpeed(value: CharacteristicValue) {
    if (value === 0) {
      this.fanState.Active = 0;
      this.fanService.updateCharacteristic(this.Characteristic.Active, this.fanState.Active);
      this.sendCommand(60, false);
    } else {
      this.fanState.Speed = value as number;
      this.sendCommand(62, Math.round(this.fanState.Speed / 20));
    }
  }
}

export class LightAccessory {
  private readonly lightService: Service;
  private readonly Characteristic: typeof Characteristic;
  private lightState = {
    On: false,
    ColorTemperature: CCT_MAX_MIREDS,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
    private readonly fan: FanAccessory,
  ) {
    this.Characteristic = this.platform.Characteristic;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.Characteristic.Model, 'Ceiling Fan Light')
      .setCharacteristic(this.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id + '-light');

    // Remove stale Switch service if present from old cache
    const staleSwitch = this.accessory.getService(this.platform.Service.Switch);
    if (staleSwitch) {
      this.accessory.removeService(staleSwitch);
    }

    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.setCharacteristic(this.Characteristic.Name, `${accessory.context.device.name} Light`);
    this.lightService.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.lightState.On)
      .onSet(this.setLightOn.bind(this));
    this.lightService.getCharacteristic(this.Characteristic.ColorTemperature)
      .onGet(() => this.lightState.ColorTemperature)
      .onSet(this.setLightColorTemperature.bind(this))
      .setProps({ minValue: CCT_MIN_MIREDS, maxValue: CCT_MAX_MIREDS, minStep: CCT_STEP });
  }

  private miredsToTuya(mireds: number): number {
    return Math.round((CCT_MAX_MIREDS - mireds) / (CCT_MAX_MIREDS - CCT_MIN_MIREDS) * 1000);
  }

  setLightOn(value: CharacteristicValue) {
    this.lightState.On = value as boolean;
    this.fan.sendCommand(20, this.lightState.On);
  }

  setLightColorTemperature(value: CharacteristicValue) {
    this.lightState.ColorTemperature = value as number;
    this.fan.sendCommand(23, this.miredsToTuya(this.lightState.ColorTemperature));
  }
}
