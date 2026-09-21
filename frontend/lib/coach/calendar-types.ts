/** Public calendar metadata. Credentials and the TTARS owner binding never leave the server. */
export type CalendarRange={from:string;to:string};
export type CalendarEvent={id:string;subject:string;start:string;end:string;is_all_day:boolean;show_as:string;is_private:boolean;start_local?:string;end_local?:string};
export type CalendarBridgeStatus="connected"|"needs_reconnect"|"unavailable";
export type CalendarSnapshot=CalendarRange&{version:1;status:CalendarBridgeStatus;events:CalendarEvent[];updated_at:string|null;limitations:string[]};
export type CalendarStatus={configured:boolean;enabled:boolean;status:CalendarBridgeStatus|"not_configured"|"paused"|"not_synced"|"stale";updated_at:string|null;from:string|null;to:string|null;limitations:string[]};
export type CalendarContext=CalendarStatus&{events:CalendarEvent[];planned_only:true};
