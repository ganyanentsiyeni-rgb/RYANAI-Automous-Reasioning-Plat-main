import { EventHandlerRegistry } from './eventHandlerRegistry.js';

/**
 * Central server-owned registry. Feature modules may register handlers here
 * during startup; external event data can never register or replace handlers.
 */
export const intelligenceEventHandlers = new EventHandlerRegistry();
