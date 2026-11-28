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
 * (focusable, the page's own Esc/keyboard controls visible) or at rest
 * (not focusable, every in-page control hidden, other apps keep their
 * keyboard). Taken over always implies maximized: taking over from the
 * small window maximizes it first, and releasing the takeover restores
 * the small window.
 *
 * The takeover never forces the soft keyboard up: the keyboard appears
 * naturally when the user taps a text field in the computer or the page's
 * own keyboard button. Dismissing the keyboard therefore never ends the
 * takeover — it ends only on an explicit takeover tap, maximize/restore,
 * or close.
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

  /** The window is being closed. */
  data object WindowClosed : SystemFloatTakeoverEvent
}

enum class SystemFloatTakeoverEffect {
  MAXIMIZE_WINDOW,
  RESTORE_WINDOW,
  MAKE_FOCUSABLE,
  MAKE_NOT_FOCUSABLE,
  HIDE_KEYBOARD,
  /** Swap the injected screen chrome between float and takeover rules. */
  APPLY_SCREEN_CHROME,
  UPDATE_TAKEOVER_BUTTON,
}

data class SystemFloatTakeoverTransition(
  val state: SystemFloatTakeoverState,
  val effects: Set<SystemFloatTakeoverEffect>,
)

/**
 * The next state and effects for [event] in [state]. The service applies
 * the effects in its own fixed order (hide keyboard before restoring,
 * resize before changing focus, chrome after focus), so the
 * order inside [SystemFloatTakeoverTransition.effects] does not matter.
 */
fun reduceTakeover(
  state: SystemFloatTakeoverState,
  event: SystemFloatTakeoverEvent,
): SystemFloatTakeoverTransition {
  return when (event) {
    SystemFloatTakeoverEvent.TakeoverTapped -> {
      if (state.isTakenOver) {
        // Tapping again releases everything: hide the keyboard if the
        // user had it up, give focus back to the underlying app, switch
        // the chrome back to float, and restore the small window.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
          setOf(
            SystemFloatTakeoverEffect.HIDE_KEYBOARD,
            SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE,
            SystemFloatTakeoverEffect.RESTORE_WINDOW,
            SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else if (state.isMaximized) {
        // Taking over switches the chrome to takeover (Esc/keyboard bar
        // visible) and makes the window focusable so the keyboard can
        // appear naturally when the user taps a text field or the
        // page's own keyboard button. Nothing forces it up.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      } else {
        // Taking over from the small window maximizes it first, then
        // switches the chrome and makes it focusable, as above.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAXIMIZE_WINDOW,
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME,
            SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
          ),
        )
      }
    }
    SystemFloatTakeoverEvent.MaximizeTapped -> {
      if (state.isMaximized) {
        // Restoring releases a takeover first: the small window never holds
        // focus, so the underlying app gets its keyboard back, and the
        // chrome goes back to float.
        val effects = mutableSetOf(
          SystemFloatTakeoverEffect.RESTORE_WINDOW,
          SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
        )
        if (state.isTakenOver) {
          effects += SystemFloatTakeoverEffect.HIDE_KEYBOARD
          effects += SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE
          effects += SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME
        }
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
          effects,
        )
      } else {
        // Maximizing alone never takes over: only the explicit takeover
        // tap (or a tap into the maximized screen) does.
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
        // Tapping into the maximized screen takes over: focusable, and
        // the takeover chrome, so the Esc/keyboard bar is there to drive
        // with. No keyboard is forced — it appears naturally when the
        // user taps a text field or the page's keyboard button.
        SystemFloatTakeoverTransition(
          SystemFloatTakeoverState(isMaximized = true, isTakenOver = true),
          setOf(
            SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
            SystemFloatTakeoverEffect.APPLY_SCREEN_CHROME,
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
    SystemFloatTakeoverEvent.WindowClosed -> {
      SystemFloatTakeoverTransition(
        SystemFloatTakeoverState(isMaximized = false, isTakenOver = false),
        emptySet(),
      )
    }
  }
}
