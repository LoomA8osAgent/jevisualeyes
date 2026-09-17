/** Groove grammar: universal rhythmic parameters, not named genres.
 * Per lane per section, Jev picks a value on each axis; code then samples
 * bar renderings from that parameter point. Styles are coordinates in the
 * space — a bossa clave, a four-on-the-floor, and an alberti figure all
 * emerge from the same axes instead of being authored entries.
 * 'any' means the axis is left unconstrained for that lane. */
import type {LaneRole} from './types.js';

export interface GrooveOption {id:string; label:string}
export interface GrooveAxis {id:string; label:string; options:GrooveOption[]}
export type GrooveParams = Record<string,string>;

const ANY={id:'any',label:'Unrestricted'};

export const GROOVE_AXES:Record<LaneRole,GrooveAxis[]>={
  drums:[
    {id:'kick',label:'Kick placement',options:[
      {id:'beats',label:'On the beats'},
      {id:'driving',label:'Driving — every beat'},
      {id:'sparse',label:'Sparse — mostly beat 1'},
      {id:'syncopated',label:'Syncopated off-beat hits'},
      {id:'off',label:'No kick'},
      ANY]},
    {id:'snare',label:'Snare / backbeat layer',options:[
      {id:'backbeat',label:'Beats 2 and 4'},
      {id:'third',label:'Beat 3 only — half-time feel'},
      {id:'syncopated',label:'Syncopated accents'},
      {id:'off',label:'No snare'},
      ANY]},
    {id:'hats',label:'Hat / cymbal density',options:[
      {id:'eighths',label:'Every eighth note'},
      {id:'quarters',label:'Quarter notes'},
      {id:'sixteenths',label:'Sixteenth notes'},
      {id:'sparse',label:'Sparse accents'},
      {id:'off',label:'No hats'},
      ANY]},
    {id:'accent',label:'Accent layer',options:[
      {id:'none',label:'None'},
      {id:'clave',label:'Clave / rim-click pattern'},
      {id:'open_hat',label:'Open-hat off-beats'},
      {id:'crash',label:'Crash on bar starts'},
      ANY]}],
  bass:[
    {id:'rhythm',label:'Bass rhythm',options:[
      {id:'quarters',label:'Quarter notes'},
      {id:'eighths',label:'Eighth notes'},
      {id:'dotted',label:'Dotted long–short figures'},
      {id:'sustained',label:'Long sustained notes'},
      {id:'syncopated',label:'Syncopated'},
      ANY]},
    {id:'pitches',label:'Bass note choice',options:[
      {id:'root',label:'Chord root only'},
      {id:'root_fifth',label:'Root and fifth'},
      {id:'chord_tones',label:'Chord tones including third'},
      {id:'walking',label:'Stepwise walking line'},
      ANY]}],
  harmony:[
    {id:'attack',label:'Chord attack pattern',options:[
      {id:'block',label:'Chord hits on the beats'},
      {id:'comp',label:'Off-beat stabs / comping'},
      {id:'arp',label:'Arpeggiated through the bar'},
      {id:'sustain',label:'One sustained voicing'},
      {id:'sparse',label:'Sparse hits with space'},
      ANY]},
    {id:'density',label:'Voicing density',options:[
      {id:'full',label:'Full voicings'},
      {id:'light',label:'Light — fewer notes'},
      ANY]}],
  lead:[
    {id:'density',label:'Melody density',options:[
      {id:'sparse',label:'Sparse — few long notes'},
      {id:'medium',label:'Moderate'},
      {id:'busy',label:'Busy runs'},
      ANY]},
    {id:'syncopation',label:'Melody placement',options:[
      {id:'onbeat',label:'On the beat'},
      {id:'mixed',label:'Mixed on- and off-beat'},
      {id:'syncopated',label:'Syncopated / anticipated'},
      ANY]}],
};
