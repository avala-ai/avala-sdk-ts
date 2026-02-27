import type { HttpTransport } from "../../http.js";
import { FleetAlertsResource, FleetAlertChannelsResource } from "./alerts.js";
import { FleetDevicesResource } from "./devices.js";
import { FleetEventsResource } from "./events.js";
import { FleetRecordingsResource } from "./recordings.js";
import { FleetRulesResource } from "./rules.js";

export class FleetResource {
  public readonly devices: FleetDevicesResource;
  public readonly recordings: FleetRecordingsResource;
  public readonly events: FleetEventsResource;
  public readonly rules: FleetRulesResource;
  public readonly alerts: FleetAlertsResource;
  public readonly alertChannels: FleetAlertChannelsResource;

  constructor(http: HttpTransport) {
    this.devices = new FleetDevicesResource(http);
    this.recordings = new FleetRecordingsResource(http);
    this.events = new FleetEventsResource(http);
    this.rules = new FleetRulesResource(http);
    this.alerts = new FleetAlertsResource(http);
    this.alertChannels = new FleetAlertChannelsResource(http);
  }
}
