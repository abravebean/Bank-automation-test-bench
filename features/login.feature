# Requirements R1-R3 (compliance/requirements.json). Tags carry through to the compliance report.
# Needs BANK_URL (and BANK_USERNAME / BANK_PASSWORD for the sign-in scenario); skipped otherwise.
Feature: Signing in to the demo bank
  As a bank customer
  I want to sign in and out securely
  So that only I can reach my accounts

  Background:
    Given I am on the bank login page

  @R1
  Scenario: A customer signs in and signs out
    When I sign in with my valid credentials
    Then I see the welcome screen
    When I sign out
    Then I am back on the login form

  @R2
  Scenario Outline: Wrong credentials are rejected: <case>
    When I sign in as "<username>" with password "<password>"
    Then I see a sign-in error
    And no session is started

    Examples:
      | case                  | username        | password                  |
      | unknown user          | not-a-real-user | definitely-wrong-password |
      | wrong password        | $BANK_USERNAME  | definitely-wrong-password |
      | SQL injection attempt | ' OR '1'='1     | ' OR '1'='1               |

  @R3
  Scenario: The password is hidden while typing
    When I type "visible-if-not-masked" into the password field
    Then the password field hides what I typed
