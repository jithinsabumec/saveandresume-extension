import type React from 'react'
import type { AuthUser, InfoButtonProps } from '../types'
import ProfileDropdown from './ProfileDropdown'
import logoUrl from '../../logo(icon+wordmark).svg'
import profilePlaceholderUrl from '../../profile.png'

interface HeaderProps {
  user: AuthUser | null
  onSignIn: () => void
  onSignOut: () => void
  isDisabled: boolean
  isProfileDropdownOpen: boolean
  profileTooltip: string
  studyModeEnabled: boolean
  profileButtonWrapperRef: React.RefObject<HTMLDivElement>
  onToggleProfileDropdown: (event: React.MouseEvent<HTMLButtonElement>) => void
  onToggleStudyMode: (event: React.MouseEvent<HTMLButtonElement>) => void
  signedInInfoButtonProps: InfoButtonProps
  signedOutInfoButtonProps: InfoButtonProps
}

export default function Header({
  user,
  onSignIn,
  onSignOut,
  isDisabled,
  isProfileDropdownOpen,
  profileTooltip,
  studyModeEnabled,
  profileButtonWrapperRef,
  onToggleProfileDropdown,
  onToggleStudyMode,
  signedInInfoButtonProps,
  signedOutInfoButtonProps
}: HeaderProps): JSX.Element {
  return (
    <header className="main-header">
      <div className="header-left">
        <img src={logoUrl} width="82" alt="Save & Resume icon" />
      </div>
      <div className="header-right">
        <div id="profile-btn-wrapper" ref={profileButtonWrapperRef} className="profile-button-wrapper">
          <button
            id="profile-button"
            className="profile-button"
            type="button"
            aria-haspopup="true"
            aria-expanded={isProfileDropdownOpen ? 'true' : 'false'}
            aria-label={profileTooltip}
            title={profileTooltip}
            onClick={onToggleProfileDropdown}
          >
            <img id="user-photo" src={user?.photoURL || profilePlaceholderUrl} alt="Profile photo" title={profileTooltip} />
          </button>
          <ProfileDropdown
            user={user}
            isDisabled={isDisabled}
            isOpen={isProfileDropdownOpen}
            studyModeEnabled={studyModeEnabled}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onToggleStudyMode={onToggleStudyMode}
            signedInInfoButtonProps={signedInInfoButtonProps}
            signedOutInfoButtonProps={signedOutInfoButtonProps}
          />
        </div>
      </div>
    </header>
  )
}
