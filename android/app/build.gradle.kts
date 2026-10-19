plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.openscreens.app"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.openscreens.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { buildConfig = true }
    flavorDimensions += "environment"
    productFlavors {
        create("local") {
            dimension = "environment"
            applicationIdSuffix = ".local"
            buildConfigField(
                "String",
                "BASE_URL",
                "\"" + (project.findProperty("screensBaseUrl") ?: "http://10.0.2.2:3100") + "\"",
            )
            manifestPlaceholders["cleartext"] = "true"
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            buildConfigField(
                "String",
                "BASE_URL",
                "\"" + (project.findProperty("screensBaseUrl") ?: "https://staging.invalid") + "\"",
            )
            manifestPlaceholders["cleartext"] = "false"
        }
        create("production") {
            dimension = "environment"
            buildConfigField(
                "String",
                "BASE_URL",
                "\"" + (project.findProperty("screensBaseUrl") ?: "https://screens.example.com") + "\"",
            )
            manifestPlaceholders["cleartext"] = "false"
        }
    }
    signingConfigs {
        create("pilot") {
            val keyPath = System.getenv("SCREENS_KEYSTORE")
            if (keyPath != null) {
                storeFile = file(keyPath)
                storePassword = System.getenv("SCREENS_STORE_PASSWORD")
                keyAlias = System.getenv("SCREENS_KEY_ALIAS")
                keyPassword = System.getenv("SCREENS_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (System.getenv("SCREENS_KEYSTORE") != null)
                signingConfig = signingConfigs.getByName("pilot")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.mindrot:jbcrypt:0.4")
    testImplementation("junit:junit:4.13.2")
}
