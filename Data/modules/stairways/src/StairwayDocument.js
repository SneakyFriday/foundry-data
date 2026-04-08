import { BaseStairway } from './BaseStairway.js'

/**
 * The client-side Stairway embedded document which extends the common BaseStairway abstraction.
 * Each Stairway document contains StairwayData which defines its data schema.
 *
 * @extends abstract.Document
 * @extends abstract.BaseStairway
 * @extends ClientDocumentMixin
 *
 * @see {@link data.StairwayData}                 The Stairway data schema
 * @see {@link documents.Scene}                   The Scene document type which contains Stairway embedded documents
 * @see {@link applications.LightConfig}          The Stairway configuration application
 *
 * @param {data.StairwayData} [data={}]       Initial data provided to construct the Stairway document
 * @param {Scene} parent                The parent Scene document to which this Stairway belongs
 */
export class StairwayDocument extends CanvasDocumentMixin(BaseStairway) { }
