import type React from 'react'
import type { AuthUser, InfoButtonProps } from '../types'
import googleUrl from '../../google.svg'
import signOutUrl from '../../signout.svg'
import studyModeIconUrl from '../../study-mode-icon.svg'
import infoUrl from '../../Info.svg'

interface ProfileDropdownProps {
  user: AuthUser | null
  isDisabled: boolean
  isOpen: boolean
  studyModeEnabled: boolean
  onSignIn: () => void
  onSignOut: () => void
  onToggleStudyMode: (event: React.MouseEvent<HTMLButtonElement>) => void
  signedInInfoButtonProps: InfoButtonProps
  signedOutInfoButtonProps: InfoButtonProps
}

export default function ProfileDropdown({
  user,
  isDisabled,
  isOpen,
  studyModeEnabled,
  onSignIn,
  onSignOut,
  onToggleStudyMode,
  signedInInfoButtonProps,
  signedOutInfoButtonProps
}: ProfileDropdownProps): JSX.Element {
  return (
    <div id="profile-dropdown" className="profile-dropdown" hidden={!isOpen}>
      <div id="profile-dropdown-signed-in" className="profile-dropdown-state" hidden={!user}>
        <div id="profile-user-info" className="profile-user-info">
          {user ? (
            <>
              <div className="profile-user-name">{user.displayName || 'Signed in'}</div>
              <div className="profile-user-email">{user.email || ''}</div>
            </>
          ) : null}
        </div>
        <div className="profile-divider"></div>
        <button
          id="study-mode-toggle-in"
          className="profile-menu-item profile-menu-item--with-pill"
          type="button"
          disabled={isDisabled}
          onClick={onToggleStudyMode}
        >
          <span className="profile-menu-leading study-mode-leading">
            <img src={studyModeIconUrl} width="14" height="14" alt="" />
            <span>Default to Study Mode</span>
            <span
              id="study-mode-info-btn-in"
              className="info-btn"
              role="button"
              tabIndex={0}
              aria-label="Default to Study Mode"
              title="Default to Study Mode"
              {...signedInInfoButtonProps}
            >
              <img src={infoUrl} width="14" height="14" alt="" aria-hidden="true" />
            </span>
          </span>
          <span className="study-mode-controls">
            <span
              id="study-mode-pill-in"
              className={`study-mode-pill ${studyModeEnabled ? 'is-on' : 'is-off'}`}
              aria-hidden="true"
              data-state={studyModeEnabled ? 'on' : 'off'}
            ></span>
          </span>
        </button>
        <div className="profile-divider"></div>
        <button id="sign-out-btn" className="profile-menu-item" type="button" disabled={isDisabled} onClick={onSignOut}>
          <img src={signOutUrl} width="14" height="14" alt="" />
          <span>Log out</span>
        </button>
      </div>
      <div id="profile-dropdown-signed-out" className="profile-dropdown-state" hidden={Boolean(user)}>
        <button
          id="study-mode-toggle-out"
          className="profile-menu-item profile-menu-item--with-pill"
          type="button"
          disabled={isDisabled}
          onClick={onToggleStudyMode}
        >
          <span className="profile-menu-leading study-mode-leading">
            <img src={studyModeIconUrl} width="14" height="14" alt="" />
            <span>Default to Study Mode</span>
            <span
              id="study-mode-info-btn-out"
              className="info-btn"
              role="button"
              tabIndex={0}
              aria-label="Default to Study Mode"
              title="Default to Study Mode"
              {...signedOutInfoButtonProps}
            >
              <img src={infoUrl} width="14" height="14" alt="" aria-hidden="true" />
            </span>
          </span>
          <span className="study-mode-controls">
            <span
              id="study-mode-pill-out"
              className={`study-mode-pill ${studyModeEnabled ? 'is-on' : 'is-off'}`}
              aria-hidden="true"
              data-state={studyModeEnabled ? 'on' : 'off'}
            ></span>
          </span>
        </button>
        <div className="profile-divider"></div>
        <button id="sign-in-btn" className="profile-menu-item" type="button" disabled={isDisabled} onClick={onSignIn}>
          <span className="profile-menu-leading">
            <img src={googleUrl} width="14" height="14" alt="Google" />
            <span>Sign In with Google</span>
          </span>
        </button>
      </div>
    </div>
  )
}
