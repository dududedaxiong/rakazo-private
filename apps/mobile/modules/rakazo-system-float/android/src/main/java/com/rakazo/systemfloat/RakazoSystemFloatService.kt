package com.rakazo.systemfloat

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A real system floating window for the computer screen: a WindowManager
 * overlay (TYPE_APPLICATION_OVERLAY) hosting the live noVNC page, so the
 * screen stays visible over the desktop and other apps after leaving
 * Rakazo. A foreground service keeps it alive while it is up; the window
 * goes down when the computer run ends (the JS side calls hide), when the
 * user closes it, or when the process dies.
 *
 * The window is draggable by its title bar and resizable from its
 * bottom-right grip, keeping the same 16:10 frame as the in-app float.
 * Touches outside the window pass through to the app underneath
 * (FLAG_NOT_TOUCH_MODAL). The window starts NOT_FOCUSABLE, so it never
 * steals the keyboard from other apps: it only becomes focusable while the
 * user has explicitly taken over (the takeover button, or tapping into the
 * maximized screen to type), and gives focus back as soon as the takeover
 * ends. Every focus change goes through the takeover state machine
 * (SystemFloatTakeoverState.kt) — see the decision note for why.
 */
class RakazoSystemFloatService : Service() {
  companion object {
    const val ACTION_SHOW = "com.rakazo.systemfloat.SHOW"
    const val ACTION_UPDATE_URL = "com.rakazo.systemfloat.UPDATE_URL"
    const val ACTION_HIDE = "com.rakazo.systemfloat.HIDE"
    const val EXTRA_URL = "url"
    const val EXTRA_TITLE = "title"
    const val EXTRA_LOCALE = "locale"

    private const val NOTIFICATION_ID = 9401
    private const val CHANNEL_ID = "rakazo_system_float"

    /** The window's default width, in dp — the same 300 as the in-app float. */
    private const val DEFAULT_WIDTH_DP = 300
    /** The narrowest window: its screen stays readable, like the in-app float. */
    private const val MIN_WIDTH_DP = 160
    private const val BAR_HEIGHT_DP = 36
    private const val TOP_DP = 120
    private const val EDGE_DP = 16
    private const val GRIP_DP = 28

    /** Delay before retrying showSoftInput once, so the layout update settles. */
    private const val KEYBOARD_RETRY_DELAY_MS = 250L
    /** Delay before releasing takeover after the keyboard disappears. */
    private const val KEYBOARD_DISMISS_DELAY_MS = 300L
    /** Visible-frame shrink that counts as the keyboard being up, in dp. */
    private const val KEYBOARD_VISIBLE_THRESHOLD_DP = 100

    /**
     * Hides the screen page's own control panels (the +/- zoom cluster, the
     * Esc/Tab/Ctrl and arrow-key bar, the paste/keyboard/trackpad row, and
     * the stock noVNC control bar) — the same rules the in-app float
     * injects (apps/mobile/lib/computer-screen-chrome.ts, float mode). The
     * system window is for watching only, so every panel goes. Without
     * this the buttons cover the screen: this WebView never had any
     * injection at all.
     */
    private const val SCREEN_CHROME_HIDE_JS =
      "(function(){try{var id=\"rakazo-screen-chrome\";var s=document.getElementById(id);" +
        "if(!s){s=document.createElement(\"style\");s.id=id;" +
        "s.textContent=\"#mobile-view-controls,#mobile-key-bar,#mobile-controls," +
        "#noVNC_control_bar_anchor{display:none!important}\";" +
        "(document.head||document.documentElement).appendChild(s);}}catch(e){}})();"

    @Volatile
    var isRunning = false
  }

  private var windowManager: WindowManager? = null
  private var overlay: FrameLayout? = null
  private var overlayParams: WindowManager.LayoutParams? = null
  private var titleView: TextView? = null
  private var webView: WebView? = null
  private var currentUrl: String? = null
  private var currentLocale = ""
  /** The window's size and position before it was maximized, for restoring. */
  private var savedParams: WindowManager.LayoutParams? = null
  private var isMaximized = false
  private var maximizeButton: ImageButton? = null
  private var takeoverButton: ImageButton? = null
  /** True while the user has taken over: the window is focusable and the keyboard is for the computer. */
  private var isTakenOver = false
  private val mainHandler = Handler(Looper.getMainLooper())
  private var keyboardRetryRunnable: Runnable? = null
  private var keyboardReleaseRunnable: Runnable? = null
  private var keyboardWasVisible = false
  private var keyboardLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_HIDE -> {
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_UPDATE_URL -> {
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (url.isNotBlank()) loadUrl(url)
        return START_NOT_STICKY
      }
      ACTION_SHOW -> {
        if (!Settings.canDrawOverlays(this)) {
          stopSelf()
          return START_NOT_STICKY
        }
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (url.isBlank()) {
          stopSelf()
          return START_NOT_STICKY
        }
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val locale = intent.getStringExtra(EXTRA_LOCALE).orEmpty()
        if (overlay == null) {
          createOverlay(url, title, locale)
        } else {
          if (title.isNotBlank()) titleView?.text = title
          loadUrl(url)
        }
        return START_NOT_STICKY
      }
      else -> return START_NOT_STICKY
    }
  }

  override fun onDestroy() {
    cancelKeyboardRetry()
    cancelKeyboardRelease()
    keyboardLayoutListener?.let { listener ->
      try {
        overlay?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
      } catch (_: Exception) {
        // Already detached.
      }
    }
    keyboardLayoutListener = null
    try {
      overlay?.let { windowManager?.removeView(it) }
    } catch (_: Exception) {
      // Already removed.
    }
    overlay = null
    overlayParams = null
    titleView = null
    maximizeButton = null
    takeoverButton = null
    savedParams = null
    isMaximized = false
    isTakenOver = false
    keyboardWasVisible = false
    webView?.destroy()
    webView = null
    currentUrl = null
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
    isRunning = false
    super.onDestroy()
  }

  private fun loadUrl(url: String) {
    if (url == currentUrl) return
    currentUrl = url
    webView?.loadUrl(url)
  }

  private fun currentTakeoverState() =
    SystemFloatTakeoverState(isMaximized = isMaximized, isTakenOver = isTakenOver)

  /**
   * Applies one state-machine transition: the tracked state moves first,
   * then each effect runs in a fixed order (hide keyboard before restoring,
   * resize before changing focus, keyboard only after focusable), so the
   * window can never end up focusable without the takeover button showing
   * it, or taken over without the keyboard request.
   */
  private fun applyTakeoverTransition(transition: SystemFloatTakeoverTransition) {
    isMaximized = transition.state.isMaximized
    isTakenOver = transition.state.isTakenOver
    val order = listOf(
      SystemFloatTakeoverEffect.HIDE_KEYBOARD,
      SystemFloatTakeoverEffect.MAXIMIZE_WINDOW,
      SystemFloatTakeoverEffect.RESTORE_WINDOW,
      SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE,
      SystemFloatTakeoverEffect.MAKE_FOCUSABLE,
      SystemFloatTakeoverEffect.SHOW_KEYBOARD_FORCED,
      SystemFloatTakeoverEffect.SHOW_KEYBOARD_IMPLICIT,
      SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON,
    )
    for (effect in order) {
      if (effect !in transition.effects) continue
      when (effect) {
        SystemFloatTakeoverEffect.HIDE_KEYBOARD -> hideKeyboard()
        SystemFloatTakeoverEffect.MAXIMIZE_WINDOW -> maximizeWindow()
        SystemFloatTakeoverEffect.RESTORE_WINDOW -> restoreWindow()
        SystemFloatTakeoverEffect.MAKE_NOT_FOCUSABLE -> setWindowFocusable(false)
        SystemFloatTakeoverEffect.MAKE_FOCUSABLE -> setWindowFocusable(true)
        SystemFloatTakeoverEffect.SHOW_KEYBOARD_FORCED -> showKeyboardAfterFocus(forced = true)
        SystemFloatTakeoverEffect.SHOW_KEYBOARD_IMPLICIT -> showKeyboardAfterFocus(forced = false)
        SystemFloatTakeoverEffect.UPDATE_TAKEOVER_BUTTON -> updateTakeoverButton()
      }
    }
  }

  /**
   * The takeover button: taking over maximizes a small window, makes it
   * focusable, and shows the keyboard for the computer. Tapping again
   * releases everything and restores the small window. The return path to
   * the app stays available through the foreground notification.
   */
  private fun onTakeoverTapped() {
    applyTakeoverTransition(
      reduceTakeover(currentTakeoverState(), SystemFloatTakeoverEvent.TakeoverTapped),
    )
  }

  /**
   * Toggles the window between its floating size and the full screen.
   * Resizing never shows the keyboard: only the explicit takeover tap does.
   * Restoring from a takeover releases the focus first, so the underlying
   * app gets its keyboard back.
   */
  private fun toggleMaximize() {
    applyTakeoverTransition(
      reduceTakeover(currentTakeoverState(), SystemFloatTakeoverEvent.MaximizeTapped),
    )
  }

  /** Expands the window to the full screen, saving the floating size for restoring. */
  private fun maximizeWindow() {
    val params = overlayParams ?: return
    val root = overlay ?: return
    val metrics = resources.displayMetrics
    savedParams = WindowManager.LayoutParams().apply {
      copyFrom(params)
    }
    params.width = metrics.widthPixels
    params.height = metrics.heightPixels
    params.x = 0
    params.y = 0
    maximizeButton?.setImageResource(R.drawable.ic_rakazo_system_float_restore)
    maximizeButton?.contentDescription = getString(R.string.rakazo_system_float_restore)
    windowManager?.updateViewLayout(root, params)
  }

  /** Restores the floating size saved by [maximizeWindow]. */
  private fun restoreWindow() {
    val params = overlayParams ?: return
    val root = overlay ?: return
    val saved = savedParams ?: return
    params.width = saved.width
    params.height = saved.height
    params.x = saved.x
    params.y = saved.y
    savedParams = null
    maximizeButton?.setImageResource(R.drawable.ic_rakazo_system_float_maximize)
    maximizeButton?.contentDescription = getString(R.string.rakazo_system_float_maximize)
    windowManager?.updateViewLayout(root, params)
  }

  /**
   * Makes the window focusable (takeover) or not (rest). The window starts
   * NOT_FOCUSABLE so it never steals the keyboard from other apps; it only
   * becomes focusable while the user is taken over.
   */
  private fun setWindowFocusable(focusable: Boolean) {
    val params = overlayParams ?: return
    val root = overlay ?: return
    params.flags = if (focusable) {
      params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
    } else {
      params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    }
    windowManager?.updateViewLayout(root, params)
  }

  /**
   * Brings up the soft keyboard for the computer, after the window has
   * become focusable: focus the WebView, then ask the input method. The
   * request runs posted, so the layout update from [setWindowFocusable]
   * has settled first. An explicit takeover tap uses SHOW_FORCED — the
   * user tapped once and wants the keyboard — while a passive tap into
   * the screen uses SHOW_IMPLICIT. One retry follows shortly after, in
   * case the first request raced the window becoming focusable; the retry
   * is a no-op if the keyboard is already up, and never fires once the
   * takeover has ended.
   */
  private fun showKeyboardAfterFocus(forced: Boolean) {
    val view = webView ?: return
    cancelKeyboardRetry()
    view.post {
      if (!isTakenOver) return@post
      view.requestFocus()
      showSoftInputNow(forced)
      val retry = Runnable {
        keyboardRetryRunnable = null
        if (!isTakenOver) return@Runnable
        view.requestFocus()
        showSoftInputNow(forced)
      }
      keyboardRetryRunnable = retry
      mainHandler.postDelayed(retry, KEYBOARD_RETRY_DELAY_MS)
    }
  }

  private fun showSoftInputNow(forced: Boolean) {
    val view = webView ?: return
    val inputMethodManager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
    inputMethodManager.showSoftInput(
      view,
      if (forced) InputMethodManager.SHOW_FORCED else InputMethodManager.SHOW_IMPLICIT,
    )
  }

  private fun hideKeyboard() {
    cancelKeyboardRetry()
    cancelKeyboardRelease()
    keyboardWasVisible = false
    val view = webView ?: return
    val inputMethodManager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
    inputMethodManager.hideSoftInputFromWindow(view.windowToken, 0)
    view.clearFocus()
  }

  private fun cancelKeyboardRetry() {
    keyboardRetryRunnable?.let { mainHandler.removeCallbacks(it) }
    keyboardRetryRunnable = null
  }

  private fun cancelKeyboardRelease() {
    keyboardReleaseRunnable?.let { mainHandler.removeCallbacks(it) }
    keyboardReleaseRunnable = null
  }

  /**
   * The takeover button shows whether the window is currently taken over
   * (maximized + focused): a highlight tint while taken over, plain white
   * otherwise. The button is always visible — taking over is how a small
   * window becomes maximized, so hiding it until maximized would hide the
   * only way in.
   */
  private fun updateTakeoverButton() {
    val button = takeoverButton ?: return
    button.setImageResource(R.drawable.ic_rakazo_system_float_takeover)
    button.imageTintList = ColorStateList.valueOf(
      if (isTakenOver) Color.rgb(0x7D, 0xD3, 0xFC) else Color.WHITE,
    )
    button.contentDescription = getString(
      if (isTakenOver) R.string.rakazo_system_float_release
      else R.string.rakazo_system_float_takeover,
    )
  }

  /**
   * Watches for the keyboard going away while taken over: once it was up
   * and is now gone (past a short delay, so a transient frame cannot end
   * the takeover), the takeover focus is released so other apps get their
   * keyboard back. The window stays maximized — dismissing the keyboard
   * is not a request to shrink it.
   */
  private fun watchKeyboardDismissed(root: FrameLayout) {
    val listener = ViewTreeObserver.OnGlobalLayoutListener {
      val rect = Rect()
      root.getWindowVisibleDisplayFrame(rect)
      val keyboardHeight = resources.displayMetrics.heightPixels - rect.bottom
      val keyboardVisible = keyboardHeight > dp(KEYBOARD_VISIBLE_THRESHOLD_DP)
      if (!isTakenOver) {
        keyboardWasVisible = false
        return@OnGlobalLayoutListener
      }
      if (keyboardVisible) {
        keyboardWasVisible = true
        cancelKeyboardRelease()
      } else if (keyboardWasVisible) {
        cancelKeyboardRelease()
        val release = Runnable {
          keyboardReleaseRunnable = null
          if (isTakenOver && keyboardWasVisible) {
            keyboardWasVisible = false
            applyTakeoverTransition(
              reduceTakeover(
                currentTakeoverState(),
                SystemFloatTakeoverEvent.KeyboardDismissed,
              ),
            )
          }
        }
        keyboardReleaseRunnable = release
        mainHandler.postDelayed(release, KEYBOARD_DISMISS_DELAY_MS)
      }
    }
    keyboardLayoutListener = listener
    root.viewTreeObserver.addOnGlobalLayoutListener(listener)
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun createOverlay(url: String, title: String, locale: String) {
    currentLocale = locale
    val manager = getSystemService(WINDOW_SERVICE) as WindowManager
    windowManager = manager
    val metrics = resources.displayMetrics
    val barPx = dp(BAR_HEIGHT_DP)
    val widthPx = dp(DEFAULT_WIDTH_DP)
    val heightPx = (widthPx * 10 / 16) + barPx

    val root = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        setColor(Color.rgb(0x14, 0x14, 0x14))
        cornerRadius = dp(12).toFloat()
      }
    }
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    }
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        barPx,
      )
      setPadding(dp(12), 0, dp(4), 0)
      gravity = Gravity.CENTER_VERTICAL
    }
    val titleText = TextView(this).apply {
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
      text = title
      textSize = 13f
      setTextColor(Color.WHITE)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      gravity = Gravity.CENTER_VERTICAL
    }
    titleView = titleText
    val takeoverButton = ImageButton(this).apply {
      layoutParams = LinearLayout.LayoutParams(barPx, barPx)
      setImageResource(R.drawable.ic_rakazo_system_float_takeover)
      setBackgroundResource(0)
      contentDescription = getString(R.string.rakazo_system_float_takeover)
      setOnClickListener { onTakeoverTapped() }
    }
    this.takeoverButton = takeoverButton
    val maximizeButton = ImageButton(this).apply {
      layoutParams = LinearLayout.LayoutParams(barPx, barPx)
      setImageResource(R.drawable.ic_rakazo_system_float_maximize)
      setBackgroundResource(0)
      contentDescription = getString(R.string.rakazo_system_float_maximize)
      setOnClickListener { toggleMaximize() }
    }
    this.maximizeButton = maximizeButton
    val closeButton = ImageButton(this).apply {
      layoutParams = LinearLayout.LayoutParams(barPx, barPx)
      setImageResource(R.drawable.ic_rakazo_system_float_close)
      setBackgroundResource(0)
      contentDescription = getString(R.string.rakazo_system_float_close)
      setOnClickListener { stopSelf() }
    }
    bar.addView(titleText)
    bar.addView(takeoverButton)
    bar.addView(maximizeButton)
    bar.addView(closeButton)
    // The takeover button is always visible: it is the way in from the
    // small window, and it shows the taken-over state with its tint.
    updateTakeoverButton()

    val screen = WebView(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      )
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      // Pinch to zoom the desktop: the built-in zoom controls are the
      // pinch gesture; the on-screen +/- buttons are hidden by the
      // SCREEN_CHROME_HIDE_JS injection in onPageFinished below.
      settings.setSupportZoom(true)
      settings.builtInZoomControls = true
      settings.displayZoomControls = false
      isFocusableInTouchMode = true
      webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
          super.onPageFinished(view, url)
          view.evaluateJavascript(SCREEN_CHROME_HIDE_JS, null)
        }
      }
    }
    webView = screen
    // Tapping into the maximized screen to type takes over; taps on the
    // small window stay mouse clicks into the remote screen. Returning
    // false lets the tap through to the WebView either way.
    screen.setOnTouchListener { _, event ->
      if (event.actionMasked == MotionEvent.ACTION_DOWN) {
        applyTakeoverTransition(
          reduceTakeover(currentTakeoverState(), SystemFloatTakeoverEvent.ScreenTapped),
        )
      }
      false
    }
    column.addView(bar)
    column.addView(screen)
    root.addView(column)

    val grip = View(this).apply {
      layoutParams = FrameLayout.LayoutParams(dp(GRIP_DP), dp(GRIP_DP), Gravity.BOTTOM or Gravity.END)
      setBackgroundResource(R.drawable.ic_rakazo_system_float_resize)
      contentDescription = getString(R.string.rakazo_system_float_resize)
    }
    root.addView(grip)

    val params = WindowManager.LayoutParams(
      widthPx,
      heightPx,
      if (Build.VERSION.SDK_INT >= 26) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      },
      // NOT_TOUCH_MODAL lets touches outside the window reach the app
      // underneath; NOT_FOCUSABLE keeps the window from stealing the
      // keyboard from other apps. The window only becomes focusable while
      // the user has taken over (see setWindowFocusable).
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = max(dp(EDGE_DP), metrics.widthPixels - widthPx - dp(EDGE_DP))
      y = dp(TOP_DP)
    }
    overlayParams = params
    overlay = root

    bar.setOnTouchListener(
      DragTouchListener(root, manager, params, metrics.widthPixels, metrics.heightPixels) { isMaximized },
    )
    grip.setOnTouchListener(
      ResizeTouchListener(root, manager, params, metrics.widthPixels, metrics.heightPixels, barPx) { isMaximized },
    )

    startForegroundNotification()
    manager.addView(root, params)
    watchKeyboardDismissed(root)
    isRunning = true
    loadUrl(url)
  }

  private fun startForegroundNotification() {
    val copyContext = localizedContext(this, currentLocale)
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          copyContext.getString(R.string.rakazo_system_float_channel),
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }
    val notification = notificationBuilder(copyContext)
      .setSmallIcon(R.drawable.ic_rakazo_system_float)
      .setContentTitle(copyContext.getString(R.string.rakazo_system_float_title))
      .setContentText(copyContext.getString(R.string.rakazo_system_float_text))
      .setContentIntent(openAppPendingIntent())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  @Suppress("DEPRECATION")
  private fun notificationBuilder(copyContext: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
    else Notification.Builder(this)

  private fun openAppPendingIntent(): PendingIntent {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("rakazo://"))
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics,
    ).roundToInt()

  /** Drags the window by its title bar, keeping it inside the screen. */
  private class DragTouchListener(
    private val overlayRoot: View,
    private val manager: WindowManager,
    private val params: WindowManager.LayoutParams,
    private val screenWidth: Int,
    private val screenHeight: Int,
    private val isMaximized: () -> Boolean,
  ) : View.OnTouchListener {
    private var downRawX = 0f
    private var downRawY = 0f
    private var downX = 0
    private var downY = 0

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(view: View, event: MotionEvent): Boolean {
      if (isMaximized()) return false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          downX = params.x
          downY = params.y
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val edge = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            EDGE_DP.toFloat(),
            view.resources.displayMetrics,
          ).roundToInt()
          params.x = clamp(
            downX + (event.rawX - downRawX).roundToInt(),
            edge,
            max(edge, screenWidth - params.width - edge),
          )
          params.y = clamp(
            downY + (event.rawY - downRawY).roundToInt(),
            edge,
            max(edge, screenHeight - params.height - edge),
          )
          manager.updateViewLayout(overlayRoot, params)
          return true
        }
        else -> return false
      }
    }
  }

  /**
   * Resizes the window from its bottom-right grip, keeping the 16:10 frame:
   * the drag takes its dominant axis, like the in-app float.
   */
  private class ResizeTouchListener(
    private val overlayRoot: View,
    private val manager: WindowManager,
    private val params: WindowManager.LayoutParams,
    private val screenWidth: Int,
    private val screenHeight: Int,
    private val barPx: Int,
    private val isMaximized: () -> Boolean,
  ) : View.OnTouchListener {
    private var downRawX = 0f
    private var downRawY = 0f
    private var startWidth = 0

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(view: View, event: MotionEvent): Boolean {
      if (isMaximized()) return false
      val metrics = view.resources.displayMetrics
      fun dpPx(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), metrics).roundToInt()
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          startWidth = params.width
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val minWidth = dpPx(MIN_WIDTH_DP)
          val maxWidth = max(
            minWidth,
            min(
              (screenWidth * 0.9).roundToInt(),
              ((screenHeight * 0.9 - barPx) * 1.6).roundToInt(),
            ),
          )
          val delta = max(event.rawX - downRawX, (event.rawY - downRawY) * 1.6f)
          val width = clamp(startWidth + delta.roundToInt(), minWidth, maxWidth)
          params.width = width
          params.height = (width * 10 / 16) + barPx
          manager.updateViewLayout(overlayRoot, params)
          return true
        }
        else -> return false
      }
    }
  }
}

private fun clamp(value: Int, min: Int, max: Int): Int = max(min, min(value, max))

/** The app's UI locale, for the foreground-service notification strings. */
private fun localizedContext(base: Context, tag: String): Context {
  if (tag.isBlank()) return base
  // The JS locale "zh" is Simplified Chinese; Android's resource folder is zh-rCN.
  val languageTag = if (tag == "zh") "zh-CN" else tag
  val configuration = Configuration(base.resources.configuration)
  configuration.setLocale(Locale.forLanguageTag(languageTag))
  return base.createConfigurationContext(configuration)
}
