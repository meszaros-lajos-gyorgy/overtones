/**
 * Tones module
 *
 * @module
 */

/* jshint maxlen:110 */

"use strict";

require("./webkit-audiocontext-patch")();

var extend     = require("lodash.assign"),
    utils      = require("./utils.js"),
    ctx        = new window.AudioContext(),
    masterGain = ctx.createGain(),
    defaults   = {
    	attack:  150,
    	decay:   200,
    	sustain: 0,
    	release: 1250,
    	volume:  1,
    	detune:  0,
    	type:    "sine"
    },
    sounds = [];

masterGain.connect(ctx.destination);

/**
 * @typedef Envelope
 *
 * @type Object
 * @property  {GainNode} node    The Gain Node associated with the Envelope. Notice
 *                               that this is not connected to a destination.
 * @property  {number}   attack  The attack duration of the sound (in secs).
 * @property  {number}   decay   The decay duration of the sound (in secs).
 * @property  {number}   sustain The sustain duration of the sound (in secs).
 * @property  {number}   release The release duration of the sound (in secs).
 */

/**
 * Creates the ADSR Envelope for the sound
 *
 * The parameters should be passed in milliseconds.
 *
 * @param  {number}  attack  The amount of time the sound will take to reach full amplitude
 * @param  {number}  decay   The amount of time for the sound to reach sustain amplitude after attack
 * @param  {number}  sustain The duration of the sound is kept being played. If `sustain` is < 0, the
 *                           sound will be played until manually stopped
 * @param  {number}  release The amount of time for the sound to fade out
 *
 * @return {Envelope}  The envelope object, containing the gain node.
 */
function _createEnvelope(attack, decay, sustain, release) {
	var gainNode = ctx.createGain();
	
	gainNode.gain.setValueAtTime(0, ctx.currentTime);
	
	return {
		node:    gainNode,
		attack:  attack / 1000,
		decay:   decay / 1000,
		sustain: sustain / 1000,
		release: release / 1000
	};
}

/**
 * Creates an Oscillator
 *
 * @param  {number}  frequency     The frequency of the wave
 * @param  {number}  [detune=0]    The number of cents to manipulate the frequency of the wave
 * @param  {string}  [type='sine'] The shape of the wave.
 *                                 Can be ['sine', 'square', 'sawtooth', 'triangle', 'custom']
 *
 * @return {OscillatorNode}  The oscillator node
 */
function _createOscillator(frequency, detune, type) {
	var oscillatorNode = ctx.createOscillator();
	
	oscillatorNode.frequency.value = frequency;
	oscillatorNode.detune.value    = detune || 0;
	oscillatorNode.type            = type || "sine";
	
	return oscillatorNode;
}

/**
 * Sound Constructor
 *
 * @class
 * @property  {number}  duration  The total duration of the sound.
 */
function Sound(oscillator, envelope, opts){
	/**
	 * @type {object}
	 * @property  {number}   attack  The attack duration of the sound (in secs). See {@link _createEnvelope}
	 * @property  {number}   decay   The decay duration of the sound (in secs). See {@link _createEnvelope}
	 * @property  {GainNode} node    The Gain Node associated with the sound. It won't emit any sound unless
	 *                               connected to the `masterGain`. See {@link masterGain}.
	 * @property  {number}   sustain The sustain duration of the sound (in secs). See {@link _createEnvelope}
	 * @property  {number}   release The release duration of the sound (in secs). See {@link _createEnvelope}
	 * @property  {number}   volume  The amplitude of the sound, after the decay. 1 is full amplitude.
	 * @property  {number}   maxVolume The peak amplitude of the sound.
	 */
	this.envelope = {
		node:      envelope.node,
		attack:    envelope.attack,
		decay:     envelope.decay,
		sustain:   envelope.sustain,
		release:   envelope.release,
		volume:    opts.volume,
		maxVolume: opts.maxVolume,
		
		/*
		 * Changes an envelope property and recalculates the duration.
		 *
		 * @param  {string}  prop  The property to change.
		 * @param  {Number}  val   The new value.
		 *
		 * @return void
		 */
		setProperty: (prop, val) => {
			this.envelope[prop] = val;
			
			this.duration = this.calculateDuration();
		}
	};
	/** @type  {OscillatorNode} */
	this.oscillator = oscillator;
	this.frequency  = oscillator.frequency.value;
	this.detune     = oscillator.detune.value;
	this.waveType   = oscillator.type;

	this.duration = this.calculateDuration();
}

/*
 * Calculates the duration of a sound from its envelope.
 *
 * @return {Number} The duration of the sound in seconds.
 */
Sound.prototype.calculateDuration = function(){
	var e = this.envelope;
	
	return e.attack + e.decay + e.sustain + e.release;
}

/*
 * Duplicates itself.
 *
 * @see {@link duplicateSound}
 *
 * @return  {Sound}  The copy of the sound.
 */
Sound.prototype.duplicate = function(opts){
	return duplicateSound(this, opts);
};

/**
 * Fades out a sound according to its release value. Useful for sustained sounds.
 *
 * @return  void
 */
Sound.prototype.fadeOut = function(){
	var now  = ctx.currentTime,
	    self = this;
	
	this.envelope.node.gain.cancelScheduledValues(now);
	this.envelope.node.gain.setTargetAtTime( 0, now, this.envelope.release / 5 );
	this.isPlaying = false;
	this.isStopping = true;
	
	return new Promise(function(resolve, reject){
		setTimeout( function() {
			self.stop();
			resolve(self);
		}, self.envelope.release * 1250 );
	});
};

/**
 * Calculates the interval in cents with another tone.
 *
 * @example
 * // Assume `sound` has a frequency of 440Hz
 * sound.intervalInCents(660); // returns 702
 *
 * @param  {Sound|Object|Number}  tone            A Sound object, or an object
 *                                                containing a `frequency` property,
 *                                                or the frequency itself.
 * @param  {bool}                 reduceToOctave  Whether to reduce the second
 *                                                frequency to the same octave.
 *
 * @return {int}  The interval between the two sounds rounded to the closest cent.
 */
Sound.prototype.intervalInCents = function(tone, reduceToOctave){
	var frequency = tone.frequency || tone,
	    ratio;
	
	if(reduceToOctave)
		frequency = reduceToSameOctave( { frequency: frequency }, this);
	
	ratio = this.frequency / frequency;
	
	return Math.round( 1200 * utils.logBase(2, ratio) );
};

/**
 * Calculates the approximate interval ratio with another tone.
 *
 * @example
 * // Assume `sound` has a frequency of 440Hz
 * sound.intervalRatio(660); // returns [0, 3, 2]
 *
 * @param  {Sound|Object|Number}  tone            A Sound object, or an object
 *                                                containing a `frequency` property,
 *                                                or the frequency itself.
 * @param  {bool}                 reduceToOctave  Whether to reduce the second
 *                                                frequency to the same octave.
 *
 * @return {Array}  The return value is an array of the form `[quot, num, den]`
 *                  where `quot === 0` for improper fractions.
 */
Sound.prototype.intervalRatio = function(tone, reduceToOctave){
	var frequency = tone.frequency || tone;
	
	if(reduceToOctave)
		frequency = reduceToSameOctave( { frequency: frequency }, this);

	return utils.fraction(this.frequency / frequency, 999);
};

/**
 * Calculates if another tone is an octave of the sound.
 *
 * @example
 * // Assume `sound` has a frequency of 440Hz
 * sound.isOctaveOf( { frequency: 110 } ); // returns true
 *
 * @param  {Sound|Object}  tone  A Sound object (or an object containing a `frequency` property)
 *
 * @return {bool}  True if it is, False if it isn't.
 */
Sound.prototype.isOctaveOf = function(tone){
	return utils.isPowerOfTwo( this.frequency / tone.frequency );
};

/*
 * Modifies the speed of a sound by a specified amount.
 *
 * @param  {Number}  speed  The amount to speed the sound up or down (1 is normal).
 *
 * @return void
 */
Sound.prototype.modifySpeed = function(speed){
	var e = this.envelope,
		n = 1 / speed;
	
	if(e.sustain)
		e.setProperty("sustain", e.sustain * n);
	else
		e.setProperty( "sustain", (e.attack + e.sustain) * n);
};

/**
 * Plays the sound
 *
 * It also removes itself when done if not sustained.
 *
 * @return  {Sound}  The played Sound
 */
Sound.prototype.play = function(){
	var now  = ctx.currentTime,
	    self = this;
	
	this.oscillator.start();
	
	this.isPlaying = true;

	/**
	 * Using `setTargetAtTime` because `exponentialRampToValueAtTime` doesn't seem to work properly under
	 * the current build of Chrome I'm developing in. Not sure if a bug, or I didn't get something.
	 * `setTargetAtTime` gets the `timeCostant` as third argument, which is the amount of time it takes
	 * for the curve to reach 1 - 1/e * 100% of the target. The reason why the provided arguments are divided
	 * by 5 is because after 5 times worth of the Time Constant the value reaches 99.32% of the target, which
	 * is an acceptable approximation for me.
	 *
	 * @see {@link https://en.wikipedia.org/wiki/Time_constant}
	 *
	 * @todo put an if with opts.linear = true to use linearRampToValueAtTime instead
	 */
	
	// The note starts NOW from 0 and will get to `maxVolume` in approximately `attack` seconds
	this.envelope.node.gain.setTargetAtTime( this.envelope.maxVolume, now, this.envelope.attack / 5 );
	// After `attack` seconds, start a transition to fade to sustain volume in `decay` seconds
	this.envelope.node.gain
	    .setTargetAtTime( this.envelope.volume, now + this.envelope.attack, this.envelope.decay / 5 );

	if( this.envelope.sustain >= 0 ) {
		// Setting a "keyframe" for the volume to be kept until `sustain` seconds have passed
		// (plus all the rest)
		this.envelope.node.gain
			.setValueAtTime( this.envelope.volume,
			                 now +
			                 this.envelope.attack +
			                 this.envelope.decay +
			                 this.envelope.sustain
			               );
		// Fade out completely starting at the end of the `sustain` in `release` seconds
		this.envelope.node.gain
			.setTargetAtTime( 0,
			                 now +
			                 this.envelope.attack +
			                 this.envelope.decay +
			                 this.envelope.sustain,
			                 this.envelope.release / 5
			                );

		// Start the removal of the sound process after a little more than the sound duration to account for
		// the approximation. (To make sure that the sound doesn't get cut off while still audible)
		return new Promise(function(resolve, reject){
			let effectiveSoundDuration = self.envelope.attack + self.envelope.decay + self.envelope.sustain;
			
			setTimeout( ()=>resolve(self), effectiveSoundDuration * 1000 );
			
			setTimeout( function() {
				if( !self.isStopping ) self.stop();
			}, self.duration * 1250 );
		});
	}
	
	return this;
};

/**
 * Reduces the Sound pitch to a tone within an octave of the tone.
 *
 * @example
 * // Assume `sound` has a frequency of 440Hz
 * sound.reduceToSameOctaveAs( { frequency: 65.41 } ); // sets the sound frequency to 110Hz
 *
 * @example
 * // Assume `sound` has a frequency of 440Hz
 * sound.reduceToSameOctaveAs( { frequency: 220 }, true ); // sets the sound frequency to 220Hz
 *
 * @example  <caption>The function works upwards as well</caption>
 * // Assume `sound` has a frequency of 440Hz
 * sound.reduceToSameOctaveAs( { frequency: 523.25 } ); // sets the sound frequency to 880Hz
 *
 * @param  {Sound|Object} tone    A Sound object (or an object containing a `frequency` property)
 * @param  {bool}  excludeOctave  If this option is `true`, the exact octave will be reduced
 *                                to the unison of the original sound
 *
 * @return {Sound}  The original Sound object is returned
 */
Sound.prototype.reduceToSameOctaveAs = function(tone, excludeOctave){
	this.frequency = reduceToSameOctave(this, tone, excludeOctave);

	this.oscillator.frequency.setValueAtTime( this.frequency, ctx.currentTime );

	return this;
};

/**
 * Disconnects a sound and removes it from the array of active sounds.
 *
 * @return {Sound}  The Sound object that was removed
 */
Sound.prototype.remove = function(){
	try { 
		this.oscillator.disconnect(this.envelope.node);
		this.envelope.node.gain.cancelScheduledValues(ctx.currentTime);
		this.envelope.node.disconnect(masterGain);
	}
	catch (e) {
		console.trace();
	}

	if( sounds.indexOf(this) !== -1 )
		return sounds.splice( sounds.indexOf(this), 1 )[0];
};

/**
 * Stops a sound, removing it.
 *
 * @see {@link Sound.prototype.remove}
 *
 * @return  {Sound}  The stopped Sound
 */
Sound.prototype.stop = function(){
	this.oscillator.stop();
	
	return this.remove();
};

/**
 * Creates and initializes a Sound object.
 *
 * The function accepts an optional `opts` argument.
 *
 * @alias module:tones.createSound
 *
 * @param  {number}  frequency  The frequency of the wave
 * @param  {Object}  [opts]     Options for the playing frequency
 * @param  {number}  [opts.attack]     The attack duration of the sound (in ms). See {@link _createEnvelope}
 * @param  {number}  [opts.decay]      The decay duration of the sound (in ms). See {@link _createEnvelope}
 * @param  {number}  [opts.detune]     The amount of cents to detune the frequency with.
 *                                     See {@link _createOscillator}
 * @param  {float}   [opts.maxVolume]  The maximum amplitude of the sound, reached after the attack.
 *                                     1 is full amplitude. If not provided, will default to volume.
 * @param  {number}  [opts.release]    The release duration of the sound (in ms). See {@link _createEnvelope}
 * @param  {number}  [opts.sustain]    The sustain duration of the sound (in ms). See {@link _createEnvelope}
 * @param  {string}  [opts.type]       The shape of the wave. See {@link _createOscillator}
 * @param  {float}   [opts.volume]     The amplitude of the sound, after the decay. 1 is full amplitude.
 * @param  {bool}    [opts.weigh]      If `true` weighs the volume according to the frequency.
 *                                     E.g. Volume is adjusted down for frequencies that "sound" louder.
 *
 * @return {Sound}  The Sound object.
 */
function createSound(frequency, opts){
	var opts       = extend( {}, defaults, opts ),
	    envelope   = _createEnvelope(opts.attack, opts.decay, opts.sustain, opts.release),
	    oscillator = _createOscillator(frequency, opts.detune, opts.type),
	    thisSound;
	
	opts.maxVolume = opts.maxVolume || opts.volume;
	
	if(opts.weigh) {
		opts.maxVolume = utils.weighFrequencyLoudness(frequency) * opts.maxVolume;
		opts.volume    = utils.weighFrequencyLoudness(frequency) * opts.volume;
	}
	
	thisSound = new Sound(oscillator, envelope, opts);
	
	oscillator.connect(envelope.node);
	envelope.node.connect(masterGain);
	
	sounds.push(thisSound);
	
	return thisSound;
}

/*
 * Duplicates a sound, optionally applying different options.
 *
 * @param  {Sound}  sound  The sound to duplicate.
 * @param  {Object} [opts] The options to replace in the original sound.
 *
 * @return {Sound}  The duplicated sound.
 */
function duplicateSound(sound, opts) {
	var opts = extend({}, opts),
		envelope = extend({}, sound.envelope, {
			attack:    sound.envelope.attack * 1000,
			decay:     sound.envelope.decay * 1000,
			sustain:   sound.envelope.sustain * 1000,
			release:   sound.envelope.release * 1000
		}, opts.envelope);
	
	return createSound(sound.frequency, envelope);
}

/**
 * Plays a given frequency.
 *
 * Also accepts an optional `opts` argument.
 *
 * @see {@link createSound}
 * @alias module:tones.playFrequency
 *
 * @return {Sound}  The Sound object.
 */
function playFrequency(frequency, opts) {
	var thisSound = createSound(frequency, opts);

	return thisSound.play();
}

/*
 * Simple way to play a sequence of frequencies.
 *
 * @see {@link createSound} and {@link playSequence}.
 * @alias module:tones.playFrequenciesSequence
 *
 * @param  {Array}  frequencies  An array of frequencies to be played.
 * @param  {Object} [opts]  Options for the sounds and the sequence.
 *
 * @return {Promise}  The sequence promise.
 */
function playFrequenciesSequence(frequencies, opts) {
	var sounds = frequencies.map(function(frequency) {
		return createSound(frequency, opts);
	});
	
	return playSequence(sounds, opts);
}

/*
 * Plays a sequence of overtones.
 *
 * It updates the fundamental frequency and optionally it animates the overtones
 * while playing them. The sequence is always played of copies of sounds, so the
 * originals are preserved.
 *
 * An optional options object can be passed to modify every single sound in the
 * sequence. Particularly implements a `speed` option to modify the speed of each
 * of the sounds in the sequence.
 *
 * @alias module:tones.playSequence
 *
 * @param  {Array.<Sound>}  sounds  An array of sounds to be played.
 * @param  {Object}  [opts]  Options to apply to each sound.
 *                           See {@link createSound}
 * @param  {Number}  [opts.speed]  The relative speed of playback of each sound.
 * @param  {bool}    [opts.copy]   Whether to create a copy of those sounds before
 *                                 playing them.
 *
 * @return {Promise} The sequence promise.
 *
 */
function playSequence(sounds, opts) {
	var sequence = Promise.resolve();
	
	if(opts.copy) {
		sounds = sounds.map(function(sound) {
			return sound.duplicate(opts);
		});
	}
	
	sounds.forEach(function(sound) {
		if(opts.speed)
			sound.modifySpeed(opts.speed);

		sequence = sequence.then(function() {
			return sound.play();
		}); 
	});
	
	return sequence;
}

/**
 * Reduces the Sound pitch to a tone within an octave of the tone.
 *
 * @see  {@link Sound.prototype.reduceToSameOctaveAs}
 * @alias module:tones.reduceToSameOctave
 *
 * @param  {Sound|Object} firstTone      A Sound object (or an object containing a `frequency` property)
 * @param  {Sound|Object} referenceTone  The first sound will adjust its frequency
 *                                       to the same octave as this tone
 * @param  {bool}  excludeOctave  If this option is `true`, the exact octave will be reduced
 *                                to the unison of the original sound
 *
 * @return {Number}  The frequency of the first sound within the same octave as the reference tone.
 */
function reduceToSameOctave(firstTone, referenceTone, excludeOctave){
	var targetFrequency = firstTone.frequency,
	    ratio           = targetFrequency / referenceTone.frequency;

	if( excludeOctave ) {
		while( ratio <= 0.5 || ratio >= 2 ){
			if( ratio <= 0.5 )
				targetFrequency = targetFrequency * 2;
			else
				targetFrequency = targetFrequency / 2;

			ratio = targetFrequency / referenceTone.frequency;
		}
	}
	else {
		while( ratio < 0.5 || ratio > 2 ){
			if( ratio < 0.5 )
				targetFrequency = targetFrequency * 2;
			else
				targetFrequency = targetFrequency / 2;

			ratio = targetFrequency / referenceTone.frequency;
		}
	}

return targetFrequency;
}

module.exports = {
	/**
	 * The Audio Context where the module operates
	 * @type  {AudioContext}
	 */
	context:        ctx,
	createSound:    createSound,
	duplicateSound: duplicateSound,
	/**
	 * The Master Gain node that is attached to the output device
	 * @type  {GainNode}
	 */
	masterGain:              masterGain,
	playFrequency:           playFrequency,
	playFrequenciesSequence: playFrequenciesSequence,
	playSequence:            playSequence,
	reduceToSameOctave:      reduceToSameOctave,
	/**
	 * A list of currently active sounds for manipulation
	 * @type  {array}
	 */
	sounds: sounds,
};