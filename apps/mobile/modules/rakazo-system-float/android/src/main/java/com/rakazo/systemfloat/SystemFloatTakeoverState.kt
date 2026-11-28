package com.rakazo.systemfloat

/**
 * Pure takeover/focus state machine for the system floating window.
 *
 * The window must never steal the keyboard from other apps, so it starts
 * NOT_FOCUSABLE and only becomes focusable while the user has explicitly
 * taken over the computer. This file owns every focus transition; it has no
 * Android dependencies so the rules can be reviewed (and checked) without a
 * device. [RakazoSystemFloatService] only applies the effects a transition
 * returns, in a fixed order.
 *
 * States: the window is either floating or maximized, and either taken over
 * (focusable, keyboard up for the computer) or at rest (not focusable, other
 * apps keep their keyboard). Taken over always implies maximized: taking
 * over from the small window maximizes it first, and releasing the takeover
 * restores the small window.
 */
data class SystemFloatTakeoverState(
  val isMaximized: Boolean = false,
  val isTakenOver: Boolean = false,
)

sealed interface SystemFloatTakeoverEvent {
  /** The takeover button in the title bar. */
  data object TakeoverTapped : SystemFloatTakeoverEvent

  /** The maximize/restore button in the title bar. */
  data object MaximizeTapped : SystemFloatTakeoverEvent

  /** A tap on the screen itself. */
  data object ScreenTapped : SystemFloatTakeoverEvent

  /** The soft keyboard was up for the computer and is now gone. */
  data object KeyboardDismissed : SystemFloatTakeoverEvent

  /** The window is being closed. */
  data object WindowClosed : SystemFloatTakeoverEvent
}

enum class SystemFloatTakeoverEffect {
  MAXIMIZE_WINDOW,
  RESTORE_WINDOW,
  MAKE_FOCUSABLE,
  MAKE_NOT_FOCUSABLE,
  SHOW_KEYBOARD_FORCED,
  SHOW_KEYBOARD_IMPLICIT,
  HIDE_KEYBOARD,
  UPDATE_TAKEOVER_BUTTON,
}

data class SystemFloatTakeoverTransition(
  val state: SystemFloatTakeoverState,
  val effects: Set<SystemFloatTakeoverEffect>,
)

/**
 * The next state and effects for [event] in [state]. The service applies
 * the effects in its own fixed order (hide keyboard before restoring,
 * resize before changing focus, keyboard only after focusable), so the
 * order inside [SystemFloatTakeoverTransition.effects] does not matter.
 */
fun reduceTakeover(
  state: SystemFloatTakeoverState,
  event: SystemFloatTakeoverEvent,
): SystemFloatTakeoverTransition {
  return when (event) {
    SystemFloatTakeoverEvent.TakeoverTapped -> {
      if (state.isTakenOver) {
        // Tapping again releases everything: hide the keyboard, give focus
        // back to the underlying app, and restore the small window.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
          setOf(
            SystemFloatTakeoverEffect.HIDE_KEYBOARD,
            SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE,
            SystemFloatTakeoverEffect.RESTORE_WINDOW,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else if (state.isMaximized) {
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.SHOW_KEYBOARD_FORCED,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else {
        // Taking over from the small window maximizes it first: the
        // takeover button is the only way into the maximized state that
        // also asks for the keyboard.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAXIMIZE_WINDOW,
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.SHOW_KEYBOARD_FORCED,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      }
    }
    SystemFloatTakeoverEvent.MaximizeTapped -> {
      if (state.isMaximized) {
        // Restoring releases a takeover first: the small window never holds
        // focus, so the underlying app gets its keyboard back.
        val effects = mutableSetOf(
          SystemFloatTakeoverEffect.RESTORE_WINDOW,
          SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
        )
        if (state.isTakenOver) {
          effects += SystemFloatTakeoverEffect.HIDE_KEYBOARD
          effects += SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE
        }
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
          effects,
        )
      } else {
        // Maximizing alone never shows the keyboard: only the explicit
        // takeover tap does.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = false),
          setOf(
            SystemFloatTakeoverEffect.MAXIMIZE_WINDOW,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      }
    }
    SystemFloatTakeoverEvent.ScreenTapped -> {
      if (state.isMaximized && !state.isTakenOver) {
        // Tapping into the maximized screen to type takes over, but only
        // with an implicit keyboard request: this was a passive tap, not
        // an explicit demand for the keyboard.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.SHOW_KEYBOARD_IMPLICIT,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else {
        // Taps on the small window stay mouse clicks into the remote
        // screen (watching mode); taps while already taken over change
        // nothing.
        SystemFloatTakeoverTransition(state, emptySet())
      }
    }
    SystemFloatTakeoverEvent.KeyboardDismissed -> {
      if (state.isTakenOver) {
        // The keyboard going away ends the takeover focus, but leaves the
        // window maximized: dismissing the keyboard is not a request to
        // shrink the window.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = state.isMaximized, isTakenOver = false),
          setOf(
            SystemFloatTakeoverEffect.HIDE_KEYBOARD,
            SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else {
        SystemFloatTakeoverTransition(state, emptySet())
      }
    }
    SystemFloatTakeoverEvent.WindowClosed -> {
      SystemFloatTakeoverTransition(
        SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
        emptySet(),
      )
    }
  }
}
