/**
 *  Overtones module
 *
 * @module
 */

"use strict";

var jQuery,
    App,
	microphoneStream;

var $ = jQuery = require("jquery");

require("velocity-animate");
require("jquery.animate-number");

var ls         = require("local-storage"),
	utils      = require("./lib/utils.js"),
    i18n       = require("./i18n.js"),
    intervals  = require("../data/intervals.json"),
    tones      = require("./lib/tones.js"),
    analyser   = require("./lib/spectrumAnalyser");

// Partially applied function to get the names of pitches
// @see {@link https://github.com/sunyatasattva/overtones/issues/30}
const PITCH_SET = utils.pitchSet("P1 m2 M2 m3 M3 P4 4A P5 m6 M6 m7 M7"),
      MIDI_A4   = 69,
	  /*
	   * @const  KEYCODES
       *
	   * A list of keycodes for the bottom and home row in QWERTY layout.
	   */
	  KEYCODES  = [90, 83, 88, 67, 70, 86, 71, 66, 78, 74, 77, 75, 188];

/**
 * Will hide the elements if this function is not called again for 5 seconds
 *
 * @function
 *
 * @param  {jQuery}  $element  The jQuery object of the element
 *
 * @return {Function}  The debounced function
 */
var hideElementWhenIdle = function($element) {
	var fn = utils.debounce( function() {
		if( $element.is(":hover") || $element.is(".is-active") )
			fn($element);
		else
			$element.removeClass("visible");
	}, 5000 );
	
	return fn;
};

// @todo Dirty solution
var hideNoteDetailsWhenIdle,
	hideKeyboardWhenIdle;

/**
 * Given a frequency, it gets the closest A440 12T Equal tempered note.
 *
 * It outputs the name according to a specific pitch set (@see {@link PITCH_SET}).
 *
 * @param  {Number}  frequency    The frequency to check
 * @param  {String}  [tonic="C"]  The tonic to calculate the scale
 *
 * @return {Object}  The details containing the note name, octave, accidentals,
 *                   encoded accidentals, and the cents difference to the closest
 *                   equal tempered note
 */
function frequencyToNoteDetails(frequency, tonic = "C") {
	let noteNumber = utils.getEqualTemperedNoteNumber( frequency,
					{ referencePoint: MIDI_A4, round: false } ),
		noteName   = utils.MIDIToName( noteNumber, PITCH_SET(tonic) );
	
	noteName.centsDifference = utils.decimalsToCents(noteNumber);
	noteName.accidentals     = utils.encodeAccidentals(noteName.name);

	return noteName;
}

/**
 * Fades out all playing sounds
 *
 * @return  void
 */
function stopAllPlayingSounds() {
	tones.sounds.forEach(function(sound){
		if(sound.isPlaying)
			sound.fadeOut();
	});
	
	$(".overtone")
	.removeData("isPlaying")
	.removeClass("is-playing");
	
	if( $("body").hasClass("easter-egg") )
		$("body").removeClass("easter-egg") // @todo decouple this from here
}

/**
 * Animates an overtone for a given duration
 *
 * @param  {string}  el        Element selector
 * @param  {number}  duration  Duration of the animation in milliseconds
 *
 * @return  void
 */
function animateOvertone(el, duration) {
	var $el              = $(el),
	    $spacesGroup     = $el.find(".spaces"),
	    // We'll animate the circles from the inner to the outer, that's
	    // why we are reversing the array
	    $circles         = $( $spacesGroup.find("g").get().reverse() ),
	    numbersOfCircles = $circles.length,
	    originalFill     = "#FFFFFF",
	    fillColor        = "#FFE08D",
		animationSustain = Math.max(duration.sustain * 1000, 0);

	// If it's already animating, it won't animate again
	if( $el.find(".velocity-animating").length )
		return;

	el.classList.add("active");
	
	// If there are no inner circles, the animation only fills the spaces
	// with the fillColor
	
	if( !numbersOfCircles ) {
		$.Velocity(
			$spacesGroup,
			{
			fill: fillColor
			}, 
			{ duration: duration.attack * 1000 + animationSustain }
		)
		.then(
			function(spaces){
				$.Velocity( spaces, { fill: originalFill });
				el.classList.remove("active");
			}, 
			{ duration: duration.release * 1000 }
        );
	}
	// If there are inner circles, we iterate through the circles and fill
	// them progressively
	else {
		$circles.each(function(i){
			var delay = i * (
				(duration.attack * 1000 / numbersOfCircles) + 
				(animationSustain / numbersOfCircles)
			);
			
			$.Velocity( this, {
				fill: fillColor
			}, {
				delay:    delay,
				duration: duration.attack * 1000 + animationSustain,
			} )
				.then( function(circle){
				$.Velocity( circle, { fill: originalFill });
				if( i === $circles.length - 1 )
					el.classList.remove("active");
			}, { duration: duration.release * 1000 } );
		});
	}
}

/**
 * Shows the difference between a tone and its closest frequency in a given tuning.
 *
 * @todo  Implement tuning parameter
 * @todo  Refactor this to actually return something interesting
 *
 * @param  {Sound}  tone  The Sound object
 *
 * @return  void
 */
function showIntervalDifferenceWithTuning(tone, tuning) {
	var tuning = tuning || "12-TET", // @todo this doesn't do anything currently, placeholder

	    note            = frequencyToNoteDetails(tone.frequency, App.baseTone.name),
		localizedNote   = i18n.t( note.name, ["notes"] ),
	    centsDifference = note.centsDifference;
	
	$("#note-frequency")
	// Set the base number from which to animate to the current frequency
		.prop( "number", $("#note-frequency").text().match(/\d+/)[0] )
		.animateNumber({
		number:     tone.frequency,
		numberStep: function(now, tween){
			var flooredNumber = Math.floor(now),
			    $target        = $(tween.elem);
			
			$target.text(flooredNumber + " Hz");
		}
	}, 200);

		// Fills up the note name (disregarding the accidental)
		$("#note-name").text( localizedNote.replace(/[b#]/g, "") );
		// Fills up the note accidentals
		$("#note-accidentals").html( note.accidentals );
		// Fills up the note octave
		$("#note sub").text( note.octave );
		
		// Fills up the bar indicating the cents difference: a difference of 0
		// would have the pointer at the center, with the extremes being 50
		$(".cents-difference.tuning")
				.css("text-indent", centsDifference + "%")
				.find(".cents").prop( "number", $(".tuning .cents").text() ).animateNumber({
				number: centsDifference,
				numberStep: function(now, tween){
						var flooredNumber = Math.floor(now),
						    target = tween.elem;
						target.innerHTML = flooredNumber > 0 ? "+" + flooredNumber : flooredNumber;
				}
		}, 200);
		
		$(".tuning .cent-bar").css("left", 50 + centsDifference / 2 + "%");
		
		console.log(note.name, centsDifference);
}

/**
 * Gets the interval name between two frequencies or a ratio.
 *
 * @param  {Array|Sound}  a   An Array containing the ratio or a Sound object.
 * @param  {Sound}        [b] The second Sound object to compare with.
 *
 * @return {string}  The interval name;
 */
function getIntervalName(a, b) {
	var ratio,
		intervalName;

	if(arguments.length === 2 && a.frequency && b.frequency)
		ratio = b.intervalRatio(a);
	else
		ratio = a;
	
	try {
		intervalName = intervals[ ratio[1] + "/" + ratio[2] ].name;
	}
	catch(e) {
		try {
			intervalName = intervals[ ratio[2] + "/" + ratio[1] ].name;
		}
		catch(e) {
			intervalName = "Unknown interval";
		}
	}
	
	return i18n.t(intervalName, ["intervals"]);
}

/**
 * Shows the interval name between two tones
 *
 * @param  {Sound}  firstTone
 * @param  {Sound}  secondTone
 *
 * @return  {string}  The interval name;
 */
function showIntervalName(firstTone, secondTone) {
	var ratio = firstTone.intervalRatio(secondTone, true),
	    intervalName = getIntervalName(ratio),
	    centsDifference = Math.abs( firstTone.intervalInCents(secondTone, true) );

	$("#interval-name").text(intervalName);
	
	$("#interval sup").text( ratio[2] );
	$("#interval sub").text( ratio[1] );
	
	$(".cents-difference.interval")
		.css("text-indent", centsDifference / 12 + "%")
		.find(".cents").prop( "number", $(".interval .cents").text() )
		.animateNumber( {number: centsDifference }, 200 );
	
	$(".interval .cent-bar").css("left", centsDifference / 12 + "%");
	
	return intervalName;
}

/**
 * Fills in the sound details
 *
 * It will show the sound details section and make sure that it disappears if idle.
 * If an array is passed, it will show the interval information between the first two,
 * otherwise it will show the sound information with the difference with 12-TET tuning.
 *
 * @param  {Sound[]|Sound}  A single Sound or an Array of Sounds.
 *
 * @return  void
 */
function fillSoundDetails(tones) {
	$("#sound-details").addClass("visible");
	hideNoteDetailsWhenIdle();
	
	if( !tones.length ) {
		$("#sound-details").addClass("show-note").removeClass("show-interval");
		showIntervalDifferenceWithTuning(tones);
	}
	else {
		$("#sound-details").addClass("show-interval").removeClass("show-note");
		showIntervalName( tones[0], tones[1] );
	}
}

/**
 * Will play an interval and animate two overtones.
 *
 * If `overtones.options.groupNotes` is set to `true` will play the sounds
 * together, otherwise with a small delay of 250ms.
 *
 * @param  {Sound[]}  tones  An Array of Sounds, will play the first two.
 * @param  {int}      idx    The index of the spiral piece within the overtone spiral
 *
 * @return  void
 */
function playIntervalOnSpiral(tones, idx) {
	if ( !tones.length )
		return;
	
	tones[0].play();
	animateOvertone( $(".overtone")[idx - 1], tones[0].envelope );

	if( App.options.groupNotes ) {
		tones[1].play();
		animateOvertone( $(".overtone")[idx], tones[1].envelope );
	}
	else {
		setTimeout( function(){
			tones[1].play();
			animateOvertone( $(".overtone")[idx], tones[1].envelope );
		}, 250);
	}
}

/**
 * Plays a certain interval over an axis of the overtone spiral
 *
 * So it will play all the displayed octaves of that same interval. Notes
 * can be played sequentially or grouped depending on the value of the
 * `overtones.options.groupNotes` option.
 *
 * @param  {number}  interval  The interval with the fundamental tone
 * @param  {Sound}   tone      The first iteration of the tone on the axis
 *
 * @return  void
 */
function playIntervalOnAxis(interval, tone) {
	tones.playFrequency( App.baseTone.frequency );
	animateOvertone( $(".overtone")[0], App.baseTone.envelope );

	/*
	* Notes are grouped
	*/
	if( App.options.groupNotes ){
		if( App.options.octaveReduction ) {
			tone.play();
			animateOvertone( $(".overtone")[interval - 1], tone.envelope );
		}
		else {
			// Loop through the first overtone and all the octaves of the same interval
			while( $("#overtone-" + interval).length ) {
				tones.playFrequency( interval * App.baseTone.frequency );
				animateOvertone( $(".overtone")[interval - 1], tone.envelope );
				interval = interval * 2;
			}
			
			tone.remove();
		}
	}
	/*
	* Notes are played sequentially
	*/
	else {
		if( App.options.octaveReduction ){
			setTimeout(function(){
				tone.play();
				animateOvertone( $(".overtone")[interval - 1], tone.envelope );
			}, 250);
		}
		else {
			var axisIntervals = [];
			
			// Push into an array all the octaves of the same interval present
			// on one particular axis
			while( $("#overtone-" + interval).length ) {
				axisIntervals.push(interval);
				interval = interval * 2;
			}
			
			// For each of them, play them sequentially with a delay of 250ms
			axisIntervals.forEach(function(interval, idx){
				setTimeout(function(){
					tones.playFrequency( interval * App.baseTone.frequency );
					animateOvertone( $(".overtone")[interval - 1], tone.envelope );
				}, 250 * (idx + 1));
			});
			
			tone.remove();
		}
	}
}

/**
 * Toggles an option value (also updates the controls)
 *
 * @param  {string}  option  The option name
 *
 * @return {bool}  The new option state
 */
function toggleOption(option, originalEvent) {
	var event;
	
    App.options[option] = !App.options[option];
    $("[data-option=" + option + "]").toggleClass("off");
	
	event = new jQuery.Event(originalEvent, {
		type: "overtones:options:change",
		details: { optionName: option, optionValue: App.options[option] }
	});

	$(document).trigger(event);

	return App.options[option];
}

/**
 * Updates the Fundamental tone frequency
 *
 * Makes sure that the controls are updated.
 *
 * @param  {number}  val    A frequency value
 * @param  {bool}    [mute] Unless set to `true` a sound will play with the new frequency
 *                          also animating the middle overtone circle
 *
 * @return {number}  The new frequency
 */
function updateBaseFrequency(val, mute) {
	const $base = $("#base");
	
	// Enforce minimum and maximums
	if( val > +$base.attr("max") )
		val = +$base.attr("max");
	else if( val < +$base.attr("min") )
		val = +$base.attr("min");

	tones.sounds[ tones.sounds.indexOf(App.baseTone) ].remove(); // Remove the base tone
	stopAllPlayingSounds();
	
	App.baseTone      = tones.createSound(val, { weigh: true });
	App.baseTone.name = frequencyToNoteDetails(val).name;
	
	$("#base, #base-detail").val(val);
	
	if( !mute && !App.options.sustain && !App.options.record )
		$("#overtone-1").click();
	
	$(document).trigger({
		type: "overtones:options:change",
		details: { optionName: "baseFrequency", optionValue: val }
	});
	
	return val;
}

/**
 * Updates the Master Volume
 *
 * @param  {number}  val    A volume value (scale 1–100)
 * @param  {bool}    [mute] Unless set to `true` a sound will play with the new volume
 *
 * @return {number}  The new volume (scale 0–1)
 */
function updateVolume(val, mute) {
	val /= 100;

	App.currentVolume = val;
	tones.masterGain.gain.setValueAtTime(App.currentVolume, tones.context.currentTime);
	if (!mute) {
		tones.playFrequency( App.baseTone.frequency );
		
		$(document).trigger({
			type: "overtones:options:change",
			details: { optionName: "mainVolume", optionValue: val }
		});
	}
	
	return val;
}

/**
 * Click Handler for Overtone circle.
 *
 * It will play and animate the overtone clicked and fill the sound details
 * for that sound.
 *
 * @see  {@link animateOvertone}
 *
 * @return  void
 */
function overtoneClickHandler() {
	var idx           = $(this).index() + 1,
	    soundPlaying  = $(this).data("isPlaying"),
	    self          = this,
	    noteFrequency = idx * App.baseTone.frequency,
	    tone;
	
	if(soundPlaying){
		soundPlaying.fadeOut();
		$(this)
		.removeData("isPlaying")
		.removeClass("is-playing");
		
		if( $("body").hasClass("easter-egg") )
			$("body").removeClass("easter-egg") // @todo decouple this from here
		return;
	}
	
	tone = tones.createSound(noteFrequency, { weigh: true });
	tone.fromClick = true;
	
	if( App.options.octaveReduction && tone.frequency !== App.baseTone.frequency )
		tone.reduceToSameOctaveAs(App.baseTone);
	
	if( App.options.record ) {
		recordSound(tone);
	}
	
	if( App.options.sustain ){
		let lastSoundPlaying = utils.findLast(tones.sounds, function(){ return this.isPlaying; }, 1);
		tone.envelope.sustain = -1;
		$(this).data("isPlaying", tone);
		$(this).addClass("is-playing"); // For styling purposes
		
		// Show the interval between this sound and the sound before it which
		// is still playing.
		if( lastSoundPlaying ) {
			fillSoundDetails([
				lastSoundPlaying,
				tone
			]);
		}
		else fillSoundDetails(tone);
		
		if( $(".overtone.is-playing").length === $(".overtone").length )
			$(document).trigger("overtones:play:all");
	}
	else fillSoundDetails(tone);

	tone.play();

	animateOvertone( self, tone.envelope );
	
	$(document).trigger({
		type: "overtones:play",
		details: { element: "overtone", idx: idx, frequency: tone.frequency, options: App.options }
	});
}

/*
 * Context handler for overtones circles.
 *
 * On right click it will update the base frequency to the octave reduced frequency
 * of the overtone clicked. If the first partial is clicked, the base frequency is
 * set to an octave lower of the original one.
 *
 * @param  {Event}  e  The event object.
 *
 * @return  void
 */
function overtoneContextHandler(e) {
	var idx           = $(this).index() + 1,
		noteFrequency = idx * App.baseTone.frequency;
	
	e.preventDefault();
	
	if(idx === 1)
		updateBaseFrequency(noteFrequency / 2);
	else {
		updateBaseFrequency( 
			tones.reduceToSameOctave(
				{ frequency: noteFrequency },
				App.baseTone
			)
		);
	}
}

/**
 * Click Handler for Spiral piece connecting two overtones
 *
 * It will play the two sounds connected by the spiral piece and fill the sound
 * details for the interval between the two.
 *
 * @see  {@link playIntervalOnSpiral}
 *
 * @return  void
 */
function spiralPieceClickHandler() {
	var idx         = $(this).index() + 1,
	    firstTone   = tones.createSound(idx * App.baseTone.frequency, { weigh: true }),
	    secondTone  = tones.createSound( (idx + 1)  * App.baseTone.frequency, { weigh: true } );

	if( App.options.octaveReduction ){
		firstTone.reduceToSameOctaveAs(App.baseTone, true);
		secondTone.reduceToSameOctaveAs(App.baseTone);
	}

	playIntervalOnSpiral( [firstTone, secondTone], idx );

	fillSoundDetails( [firstTone, secondTone] );
	
	$(document).trigger({
		type: "overtones:play",
		details: {
			element: "spiral",
			idx: idx,
			interval: getIntervalName(firstTone, secondTone),
			options: App.options
		}
	});
}

/**
 * Click Handler for Overtone Axis
 *
 * It will play an interval repeated on the axis and fill in the sound details
 * for that interval
 *
 * @see  {@link playIntervalOnAxis}
 *
 * @return  void
 */
function axisClickHandler() {
	var interval = parseInt( $(this).data("interval") ),
	    tone = tones
	           .createSound(interval * App.baseTone.frequency)
	           .reduceToSameOctaveAs(App.baseTone);

	playIntervalOnAxis(interval, tone);

	fillSoundDetails( [App.baseTone, tone] );
	
	$(document).trigger({
		type: "overtones:play",
		details: { 
			element: "axis", 
			idx: interval, 
			interval: getIntervalName(App.baseTone, tone),
			options: App.options
		}
	});
}

/**
 * Base Input handler
 *
 * Allows usage of <kbd>arrow up</kbd> and <kbd>arrow down</kbd> keys
 * to easy modify the value of the input. Using <kbd>SHIFT</kbd> allows
 * for increments of 10, while <kbd>ALT</kbd> for increments of 0.1.
 *
 * @return  void
 */
function baseInputHandler(e){
	const ARROW_UP    = 38,
	      ARROW_DOWN  = 40,
	      $this       = $(this);
	
	let currentValue = +$this.get(0).value;
	
	switch(e.keyCode){
		case ARROW_UP:
			e.preventDefault();
			
			if     (e.altKey)   $this.val(currentValue + 0.1);
			else if(e.shiftKey) $this.val(currentValue + 10);
			else                $this.val(currentValue + 1);
			
			$this.change();
			
			break;
		case ARROW_DOWN:
			e.preventDefault();
			
			if     (e.altKey)   $this.val(currentValue - 0.1);
			else if(e.shiftKey) $this.val(currentValue - 10);
			else                $this.val(currentValue - 1);
			
			$this.change();
			
			break;
	}
}

/*
 * Handles the keyboard events.
 *
 * Pressing a number will play that partial, where 0 is 10 and partials over the
 * tenth can be played by pressing <kbd>shift + n</kbd> to add 10 to the pressed
 * number.
 *
 * Pressing letters from the bottom row will play the diatonic scale starting from
 * A2 to the next octave. While playing the home row will play the black keys. Here,
 * too, <kbd>shift + key</kbd> will raise the sound one octave.
 *
 * Pressing the letters will also bring up the virtual keyboard for some time.
 *
 * @param  {Event}  e  The event object.
 *
 * @return  void
 */
function keyboardHandler(e) {
 	var n,
		$key,
		$el;
	
	if( $(e.target).is("input") )
		return;

	// Numbers from 0 to 9
  	if(e.keyCode >= 48 && e.keyCode <= 57) {
		n = e.keyCode === 48 ? 9 : e.keyCode - 49;

		if(e.shiftKey)
		  n = Math.min(n + 10, 15);

		$(".overtone").eq(n).click();
	}
	else {
		n   = KEYCODES.indexOf(e.keyCode);
		
		// Bottom row and some home row keys
		// @todo this doesn't support AZERTY
		if(n !== -1) {
			$el  = $("#keyboard-container");
			$key = $("#keyboard .key").eq(n);
			
			$el.addClass("visible");
			hideKeyboardWhenIdle();
			
			$key.addClass("is-active");
	
			setTimeout(function(){
				$key.removeClass("is-active");
			}, 200);
			
			playSoundFromKeyboardPosition(n, e.shiftKey);
		}
	}
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
 * @param  {Array.<{sound:Sound, base:Sound}>}  sequence  An array of objects
 *                                                        containing the sounds and
 *                                                        their relative base.
 * @param  {Object}  [opts]  Options to apply to each sound.
 *                           See {@link Sound.prototype.duplicate}
 * @param  {Number}  [opts.speed]    The relative speed of playback of each sound.
 * @param  {bool}    [opts.animate]  Whether to activate the overtone circle
 *                                   animation at each sound.
 *
 * @return {Promise}  A Promise resolving when the sequence of sounds is done.
 */
function playSequence(sequence, opts) {
    var _sequence = Promise.resolve(),
    _sounds   = sequence.map(function(sound) {
		var copy = sound.sound.duplicate(opts);

		if(opts.speed) {
			copy.modifySpeed(opts.speed);
		}

		return copy;
	});
    
    sequence.forEach(function(sound, i) {
		_sequence = _sequence.then(function() {
			if(sound.base.frequency !== App.baseTone.frequency)
				updateBaseFrequency(sound.base.frequency, true);

			if(opts.animate) {
				animateOvertone(
					$(".overtone").get(sound.overtone - 1),
					_sounds[i].envelope
				);
			}

			return _sounds[i].play();
		});
	 });
    
    return _sequence;
}

/*
 * Moves the recorded sequence forwards or backwards and plays it.
 *
 * @param  {Number}  step  The number of steps to move the sequence (negative
 *                         to move the sequence back).
 *
 * @return void
 */
function controlSequence(step) {
    var i     = App.sequence.current + step,
    speed = +$("#sequence-speed").val(),
    sound = App.sequence.sounds[i];
    
    if(sound) {
        playSequence([sound], { animate: true, speed: speed });
        
        App.sequence.current += step;
    }
}

/*
 * Records a sound to the current saved sequence.
 *
 * It adds the recorded sound with infromation on which overtone number it is and
 * its relative fundamental frequency to the recorded sequence and saves it to
 * local storage.
 *
 * @param  {Sound}  sound  The sound to record.
 *
 * @return {Number} The new length of the sequence.
 */
function recordSound(sound) {
    var soundCopy = sound.duplicate(),
    sequence;
    
    sequence = App.sequence.sounds.push({
                                        overtone: Math.floor(sound.frequency / App.baseTone.frequency),
                                        sound:    soundCopy,
                                        base:     App.baseTone
                                        });
    
    ls.set("overtone-sequence", App.sequence.sounds);
    
    // @todo Ideally we don't duplicate this code and we have a custom setter
    // but we might as well refactor the whole thing, really…
    $(document).trigger({
                        type: "sequence:change",
                        details: { sequence: App.sequence.sounds }
                        });
    
    return sequence;
}

/*
 * Loads a sequence from a JSON object.
 *
 * Initializes each sound in the JSON as a Sound object and loads it into
 * the current sequence.
 *
 * @param  {Object}  json  The JSON object.
 *
 * @return void
 */
function loadSequence(json) {
    var sounds;
    
    if(json.length) {
        sounds = json.map(function(sound) {
                          if(sound.sound) {
                          sound.sound = tones.duplicateSound(sound.sound);
                          }
                          
                          return sound;
                          });
    }
    
    App.sequence.sounds = sounds || [];
    
    $(document).trigger({ 
                        type: "sequence:change", 
                        details: { sequence: App.sequence.sounds }
                        });
}

/*
 * Loads a sequence from local storage.
 *
 * @return void
 */
function loadSequenceFromLocalStorage() {
    var sequence = ls.get("overtone-sequence");
    
    loadSequence(sequence);
}

/*
 * Handles clicks on the piano keys.
 *
 * @param  {Event}  e  The event object.
 *
 * @return void
 */
function pianoKeysHandler(e) {
	var n = $(this).index();
	
	playSoundFromKeyboardPosition(n, e.shiftKey);
}

/*
 * Given a position on the keyboard, plays a sound accordingly.
 *
 * Positions start at 0 for A2 and go up one semitone at the time.
 *
 * @param  {Number}  n       The position starting from A2.
 * @param  {bool}    octave  Whether to raise the note one octave.
 *
 * @return void
 */
function playSoundFromKeyboardPosition(n, octave) {
	var frequency = utils.getETFrequencyfromMIDINumber(n + MIDI_A4);
	
	if(!octave)
		updateBaseFrequency(frequency / 2);
	else
		updateBaseFrequency(frequency);
}

/*
 * Plays the reference sound from the sound details panel.
 *
 * The sound holds as long as the mouse press.
 *
 * @param  {Event}  e  The event object.
 *
 * @return void
 */
function soundDetailsHandler(e) {
	var $this     = $(this),
		frequency = parseFloat( $("#note-frequency").text() ),
		detune    = -parseInt( $(".cents-difference.tuning .cents").text() ),
		sound;
	
	if( $this.is(".show-note") ) {
		if(e.type === "mousedown") {
			sound = tones.playFrequency(frequency, { 
				detune:  detune,
				sustain: -1
			});

			$this.data("isPlaying", sound);
		}
		else {
			sound = $this.data("isPlaying");
			sound.fadeOut();
			
			$this.removeData("isPlaying");
		}
	}
}

function updateUILanguage(language) {
	i18n.setLocale(language);

	$("[data-translation-key]").each(function(){
		var key  = $(this).data("translation-key"),
			path = key.split(".");
		
		// @todo Should escape html
		// @todo refactor to i18n module, also data-key API is backwards like this
		if(path.length > 1)
			$(this).html( i18n.t( path[0], path.slice(1) ) );
		else
			$(this).html( i18n.t(key) );
	});
	
	$(".languages-list .language")
		.removeClass("current-language")
		.filter(`[data-language="${language}"]`)
		.addClass("current-language");
	
	$(".language-switcher > .current-language")
		.text( i18n.getLanguageNameFromCode(language) );
}

/**
 * Initializes the application
 *
 * Sets the master gain volume to the slider bar, attaches the event handlers to the
 * overtone spiral SVG and to the options buttons.
 *
 * @return  void
 */
function init() {
	updateVolume( $("#volume-control").val(), true );
	App.baseTone.name = frequencyToNoteDetails(App.baseTone.frequency).name;
	updateUILanguage( i18n.trySettingLocaleToPreferred() );
    
    // @todo dirty
    hideNoteDetailsWhenIdle = hideElementWhenIdle( $("#sound-details") ),
    hideKeyboardWhenIdle    = hideElementWhenIdle( $("#keyboard-container") );
	
	$(document)
		.on("keydown", keyboardHandler)
    	.on("mouseup", function(e) {
			var $soundDetails = $("#sound-details");

			if( !$soundDetails.is(":hover") && $soundDetails.data("isPlaying") )
			soundDetailsHandler.call($soundDetails, e);
        })
    	.on("overtones:options:change", function(e){
        	if( e.details.optionName === "sustain" &&
        	   e.details.optionValue === false )
        		stopAllPlayingSounds();
        	if(e.details.optionName === "microphone") {
        		if(e.details.optionValue === true) {
        		activateMicrophoneStream(e.originalEvent.altKey);
        		}
        		else {
        			toggleInput('#base');
        			toggleInput('#base-detail');
        			analyser.stop();
        			microphoneStream.stop();
        		}
        	}
        	if( e.details.optionName === "record" && e.details.optionValue === true ) {
        		App.sequence = { current: 0, sounds: [] };
        	
        		$(document).trigger({
        	    	type: "sequence:change",
        	    	details: { sequence: App.sequence.sounds }
        	    });
        	}
        })
		.on("sequence:change", function(e) {
			console.log(e.details);
			if(e.details.sequence.length)
				$("#play-panel").addClass("visible");
			else
				$("#play-panel").removeClass("visible");
		});
	
	try {
		loadSequenceFromLocalStorage();
	}
	catch(e) {
		console.error(e);
	}
	
	$(".overtone")
		.on("click", overtoneClickHandler)
		.on("contextmenu", overtoneContextHandler);
	$(".spiral-piece").on("click", spiralPieceClickHandler);
	$(".axis").on("click", axisClickHandler);

	$("#base-detail").on("keydown", baseInputHandler);

	$("#base, #base-detail").on("change", function(){
		updateBaseFrequency( $(this).val() );
	});
	
	$("#base-wrapper").on("click", function(e) {
		if( !$(e.target).is("input") )
			$("#keyboard-container").toggleClass("visible is-active");
	});
	
	$("#keyboard-container .key").on("mousedown", pianoKeysHandler);
	
	$("#sound-details").on("mousedown mouseup", soundDetailsHandler);

	$("#volume-control").on("change", function(){
	  updateVolume( $(this).val() );
	});
	
	$("[data-language]").on("click", function(){
		updateUILanguage( $(this).data("language") );
		
		$(this)
			.closest(".language-switcher")
				.find(".is-active")
					.removeClass("is-active")
				.end()
				.find(".visible")
					.removeClass("visible");
	});

	$("[data-option]").on("click", function(){
	  toggleOption( $(this).data("option") );
	});
	
	$("[data-toggle]").on("click", function(){
		var $this    = $(this),
			selector = $this.data("toggle");
		
		if(selector[0] === "&")
			$this.find( selector.substr(1) ).toggleClass("visible");
		else
			$(selector).toggleClass("visible");
		
		$this.toggleClass("is-active");
	});
	
	
	$("#play-sequence").on("click", function(){
		var speed = +$("#sequence-speed").val(),
			$this = $(this);
		
		if( !$this.is(".off") )
			return;
		
		$this.removeClass("off");
		
		playSequence(App.sequence.sounds, { 
			animate: true,
			speed:   speed
		})
		.then(function(){
			$this.addClass("off");
		});
	});
	
	$("#sequence-next").on("click", function(){
		controlSequence(1)
	});
	
	$("#sequence-prev").on("click", function(){
		controlSequence(-1)
	});
}

/*
 * Toggles an input between enabled and disabled.
 *
 * @param  {String}  selector  The selector of the input.
 *
 * @return void
 * 
 */
function toggleInput(selector) {
	var $wrapper = $(selector + '-wrapper'),
		$input   = $(selector);
	
	$wrapper.toggleClass('disabled');
	$input.attr( 'disabled', !$input.attr('disabled') );
}

/*
 * Ask the user for permission to access the microphone stream.
 *
 * @param  {bool}  debug  Whether to activate debug mode.
 *
 * @todo  Implement better degradation and clear up UI.
 *
 * @return void
 */
function activateMicrophoneStream(debug) {
	if(navigator.getUserMedia) {
		navigator.getUserMedia(
			{ audio: true },
			function(stream) {
				microphoneStream = stream.getAudioTracks()[0];
				gotStream(stream, debug);
			},
			noStream
		);
	}
	else {
		alert('Sorry, your browser does not support getUserMedia');
	}
}

/*
 * Slowly animate and highlight the overtone circles.
 *
 * @param  {jQuery}  $overtone  The overtone element.
 * @param  {Number}  k          The intensity of the highlight.
 *
 * @return void
 */
function highlightOvertone($overtone, k) {
	let fillColor = "#FFE08D",
		$spaces   = $overtone.find('.spaces');

	$overtone.velocity(
		{ scale: utils.clamp(1.5 * k, 1, 1.5) }, 
		{ duration: 15 }
	);

	$spaces.velocity(
		{ fillBlue: 1/( 1/255 * Math.max(1, k * 2) ) },
		{ duration: 15 }
	);
}

/*
 * Shows the visual representation of an overtone spectrum.
 *
 * @param  {Object}  spectrum  The overtone spectrum.
 * @param  {Number}  spectrum.fundamental  The frequency fundamental.
 * @param  {Array}   spectrum.spectrum     A spectrum of intensity (from 0 to 1) of 
 *                                         overtones from 0 to 16.
 *
 * @return void
 */
function updateOvertones(spectrum) {
	if(!spectrum.fundamental)
		return;
	Overtones.updateBaseFrequency(spectrum.fundamental, true);

	spectrum.spectrum.forEach((partial, i) => {
	  let $overtone        = jQuery(".overtone").eq(i),
		  adjustedLoudness = partial * utils.logBase(8, i + 2);

		highlightOvertone($overtone, adjustedLoudness);
	});
}

/*
 * Callback for when we get the microphone audio stream.
 *
 * Initializes the analyzer and the updating loop. Updates the overtones if there
 * is at least a confidence level of 2. See {@link module:spectrumAnalyser.update}.
 *
 * @param  {MediaStream}  stream  The audio stream.
 * @param  {bool}         debug   Whether to run the analyser in debug mode.
                                  See {@link module:spectrumAnalyser.init}
 *
 * @return void
 */
function gotStream(stream, debug){
	toggleInput('#base');
	toggleInput('#base-detail');

	analyser.init( stream, { debug: debug } );
	analyser.update((promise) => {
		promise.then((spectrum) => {
			if(spectrum.confidence > 2)
				updateOvertones(spectrum);
		});
	});
}

/*
 * Callback for when no stream is available.
 *
 * @todo implement
 */
function noStream(stream){} 

var App = {
	/**
	* The fundamental tone from which to calculate the overtones values
	*
	* @alias module:overtones.baseTone
	*
	* @type  {Sound}
	*/
	baseTone: tones.createSound( $("#base").val(), { weigh: true } ),
	init:     init,
	i18n:     i18n,
	/**
	* @alias module:overtones.options
	*
	* @type {object}
	* @property  {bool}  groupNotes      If set to `true`, it will play the notes
	*                                    at the same time.
	* @property  {bool}  octaveReduction If set to `true` all notes will be played
	*                                    on the same octave of the fundamental tone.
	*                                    See {@link baseTone}.
	*/
	options: {
		groupNotes:      true,
		octaveReduction: false
	},
	sequence: {
		current: -1,
		sounds: [],
	},
	/**
	* Frequency data for various tunings
	*
	* @alias module:overtones.tunings
	*
	* @type {object}
	*/
	tunings: {
	},
    updateBaseFrequency: updateBaseFrequency
};

module.exports = App;